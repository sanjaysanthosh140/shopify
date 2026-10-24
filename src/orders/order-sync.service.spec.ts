import { OrderSyncService } from './order-sync.service';

describe('OrderSyncService mapping', () => {
  it('maps Shopify webhook IDs and order fields without numeric coercion', () => {
    const service = new OrderSyncService({} as any, {} as any);
    const mapped = (service as any).mapWebhookOrder({
      id: '9007199254740993',
      name: '#1001',
      created_at: '2026-10-24T12:00:00.000Z',
      financial_status: 'paid',
      fulfillment_status: null,
      currency: 'INR',
      current_total_price: '59.97',
      line_items: [
        {
          id: '9007199254740994',
          title: 'Notebook',
          quantity: 3,
          price: '19.99',
        },
      ],
    });

    expect(mapped.shopifyId).toBe('9007199254740993');
    expect(mapped.total).toBe('59.97');
    expect(mapped.lineItems[0].shopifyId).toBe('9007199254740994');
    expect(mapped.lineItems[0].lineTotal).toBe('59.97');
  });
});
