
import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { isAxiosError } from 'axios';

interface ShopifyTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
}

interface ShopifyGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private tokenRequest: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  private get storeDomain(): string {
    const domain = this.config.get<string>('SHOPIFY_STORE_DOMAIN');
    if (!domain) {
      throw new InternalServerErrorException(
        'SHOPIFY_STORE_DOMAIN is not configured',
      );
    }
    return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    if (this.tokenRequest) {
      return this.tokenRequest;
    }

    this.tokenRequest = this.requestAccessToken();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }

  private async requestAccessToken(): Promise<string> {
    const clientId = this.config.get<string>('SHOPIFY_CLIENT_ID');
    const clientSecret = this.config.get<string>('SHOPIFY_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'Shopify credentials are not configured',
      );
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });

      const response = await axios.post<ShopifyTokenResponse>(
        `https://${this.storeDomain}/admin/oauth/access_token`,
        body.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 15000,
        },
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiresAt =
        Date.now() + Math.max(30, response.data.expires_in - 300) * 1000;

      return this.accessToken;
    } catch (error) {
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      this.logger.error(
        `Shopify authentication request failed${isAxiosError(error) && error.response?.status ? ` with HTTP ${error.response.status}` : ''}`,
      );
      throw new ServiceUnavailableException(
        'Shopify authentication failed. Check the app installation, organization, and environment configuration.',
      );
    }
  }

  async requestGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    const apiVersion = this.config.get<string>('SHOPIFY_API_VERSION');

    if (!apiVersion) {
      throw new InternalServerErrorException(
        'SHOPIFY_API_VERSION is not configured',
      );
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await axios.post<ShopifyGraphQLResponse<T>>(
          `https://${this.storeDomain}/admin/api/${apiVersion}/graphql.json`,
          { query, variables },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': token,
            },
            timeout: 20000,
          },
        );

        const errors = response.data.errors ?? [];
        if (!errors.length && response.data.data) {
          return response.data.data;
        }

        const isThrottled = errors.some(
          (error) => error.extensions?.code === 'THROTTLED',
        );
        lastError = new Error(
          errors.map((error) => error.message).join('; ') ||
            'Shopify returned an empty GraphQL response',
        );

        if (!isThrottled) {
          break;
        }
      } catch (error) {
        lastError = error;
        if (!isAxiosError(error) || error.response?.status !== 429) {
          break;
        }
      }

      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(2000, 250 * 2 ** attempt)),
      );
    }

    const status = isAxiosError(lastError)
      ? lastError.response?.status
      : undefined;
    this.logger.error(
      `Shopify GraphQL request failed${status ? ` with HTTP ${status}` : ''}`,
    );
    throw new BadGatewayException(
      'Shopify API request failed. Check the API version, app permissions, and store access.',
    );
  }

  async getShopInfo(): Promise<{
    name: string;
    myshopifyDomain: string;
  }> {
    const data = await this.requestGraphQL<{
      shop: { name: string; myshopifyDomain: string };
    }>(`
      query ShopInfo {
        shop {
          name
          myshopifyDomain
        }
      }
    `);

    return data.shop;
  }
}
