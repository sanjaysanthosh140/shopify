import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('shopify')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('webhooks')
  handle(
    @Req() request: RawBodyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() payload: Record<string, any>,
  ) {
    return this.webhooks.handle({
      rawBody: request.rawBody,
      payload,
      headers,
    });
  }
}
