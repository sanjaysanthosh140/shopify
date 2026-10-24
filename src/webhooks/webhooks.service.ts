import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderSyncService } from '../orders/order-sync.service';

const SUPPORTED_TOPICS = new Set(['orders/create', 'orders/updated']);

interface WebhookInput {
  rawBody: Buffer | undefined;
  payload: Record<string, any>;
  headers: Record<string, string | string[] | undefined>;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: OrderSyncService,
    private readonly config: ConfigService,
  ) {}

  async handle(input: WebhookInput) {
    const topic = this.header(input.headers, 'x-shopify-topic')?.toLowerCase();
    const deliveryId = this.header(input.headers, 'x-shopify-webhook-id');
    const eventId = this.header(input.headers, 'x-shopify-event-id');
    const shopDomain = this.header(input.headers, 'x-shopify-shop-domain');
    const signature = this.header(input.headers, 'x-shopify-hmac-sha256');

    if (!input.rawBody) {
      throw new BadRequestException('Raw webhook body is unavailable');
    }
    if (!topic || !SUPPORTED_TOPICS.has(topic)) {
      throw new BadRequestException('Unsupported Shopify webhook topic');
    }
    if (!deliveryId || !signature || !shopDomain) {
      throw new BadRequestException('Required Shopify webhook headers are missing');
    }
    if (!this.verifySignature(input.rawBody, signature)) {
      throw new UnauthorizedException('Invalid Shopify webhook signature');
    }
    if (!this.isExpectedShop(shopDomain)) {
      throw new UnauthorizedException('Unexpected Shopify shop domain');
    }
    if (!input.payload || typeof input.payload !== 'object') {
      throw new BadRequestException('Invalid Shopify webhook payload');
    }

    const existing = await this.prisma.webhookEvent.findFirst({
      where: {
        OR: [
          { deliveryId },
          ...(eventId ? [{ eventId, topic }] : []),
        ],
      },
    });

    if (existing?.status === 'PROCESSED' || existing?.status === 'PROCESSING') {
      return {
        success: true,
        duplicate: true,
        message: 'Webhook delivery already received',
      };
    }

    let event;
    if (existing) {
      event = await this.prisma.webhookEvent.update({
        where: { id: existing.id },
        data: { status: 'PROCESSING', error: null, receivedAt: new Date() },
      });
    } else {
      try {
        event = await this.prisma.webhookEvent.create({
          data: {
            deliveryId,
            eventId,
            topic,
            shopDomain,
            status: 'PROCESSING',
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') {
          throw error;
        }

        const concurrent = await this.prisma.webhookEvent.findFirst({
          where: { deliveryId },
        });
        if (concurrent?.status === 'PROCESSED' || concurrent?.status === 'PROCESSING') {
          return {
            success: true,
            duplicate: true,
            message: 'Webhook delivery already received',
          };
        }
        throw error;
      }
    }

    try {
      const result = await this.sync.syncWebhookOrder(input.payload);
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });

      return {
        success: true,
        duplicate: false,
        orderId: result.orderId,
        created: result.created,
      };
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', error: 'Order synchronization failed' },
      });
      this.logger.error('Shopify webhook order synchronization failed');
      throw error;
    }
  }

  verifySignature(rawBody: Buffer, signature: string): boolean {
    const secret = this.config.get<string>('SHOPIFY_CLIENT_SECRET');
    if (!secret) {
      return false;
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'base64');
    } catch {
      return false;
    }

    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  private isExpectedShop(shopDomain: string) {
    const configured = this.config.get<string>('SHOPIFY_STORE_DOMAIN');
    if (!configured) {
      return false;
    }

    return this.normalizeDomain(configured) === this.normalizeDomain(shopDomain);
  }

  private normalizeDomain(value: string) {
    return value
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '')
      .toLowerCase();
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | undefined {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
    const value = key ? headers[key] : undefined;
    return Array.isArray(value) ? value[0] : value;
  }
}
