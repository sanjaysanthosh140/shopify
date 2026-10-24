import {
  multiplyMoney,
  normalizeMoney,
  normalizeShopifyId,
} from './order.types';

describe('order data normalization', () => {
  it('keeps Shopify IDs as strings and removes GraphQL prefixes', () => {
    expect(normalizeShopifyId('gid://shopify/Order/9007199254740993')).toBe(
      '9007199254740993',
    );
  });

  it('does exact decimal multiplication without floating point rounding', () => {
    expect(multiplyMoney('19.99', 3)).toBe('59.97');
    expect(normalizeMoney('not-a-money-value')).toBeNull();
  });
});
