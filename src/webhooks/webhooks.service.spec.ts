import { jest } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  const secret = 'test-secret';
  const rawBody = Buffer.from(JSON.stringify({
    id: '123',
    name: '#1001',
    created_at: '2026-10-24T12:00:00.000Z',
    line_items: [],
  }));
  const signature = createHmac('sha256', secret).update(rawBody).digest('base64');

  function buildService() {
    const prisma = {
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const sync = {
      syncWebhookOrder: jest.fn().mockResolvedValue({ orderId: 'order-1', created: true }),
    };
    const config = {
      get: (key: string) =>
        ({
          SHOPIFY_CLIENT_SECRET: secret,
          SHOPIFY_STORE_DOMAIN: 'example.myshopify.com',
        })[key],
    };
    return { service: new WebhooksService(prisma as any, sync as any, config as any), prisma, sync };
  }

  it('accepts a valid HMAC and processes the order once', async () => {
    const { service, sync, prisma } = buildService();
    const result = await service.handle({
      rawBody,
      payload: JSON.parse(rawBody.toString()),
      headers: {
        'x-shopify-topic': 'orders/create',
        'x-shopify-webhook-id': 'delivery-1',
        'x-shopify-event-id': 'event-1',
        'x-shopify-shop-domain': 'example.myshopify.com',
        'x-shopify-hmac-sha256': signature,
      },
    });

    expect(result.success).toBe(true);
    expect(sync.syncWebhookOrder).toHaveBeenCalledTimes(1);
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
    );
  });

  it('rejects invalid signatures before touching persistence', async () => {
    const { service, prisma } = buildService();
    await expect(
      service.handle({
        rawBody,
        payload: JSON.parse(rawBody.toString()),
        headers: {
          'x-shopify-topic': 'orders/create',
          'x-shopify-webhook-id': 'delivery-1',
          'x-shopify-shop-domain': 'example.myshopify.com',
          'x-shopify-hmac-sha256': 'invalid',
        },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(prisma.webhookEvent.findFirst).not.toHaveBeenCalled();
  });
});
