export interface NormalizedOrderItem {
  shopifyId: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface NormalizedOrder {
  shopifyId: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  orderedAt: Date;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  currencyCode: string;
  subtotal: string | null;
  total: string | null;
  tax: string | null;
  shipping: string | null;
  cancelledAt: Date | null;
  lineItems: NormalizedOrderItem[];
  completeLineItems: boolean;
}

export function normalizeShopifyId(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new Error('Shopify resource is missing an ID');
  }

  const slashIndex = raw.lastIndexOf('/');
  return slashIndex >= 0 ? raw.slice(slashIndex + 1) : raw;
}

export function normalizeMoney(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

export function multiplyMoney(value: string | null, quantity: number): string | null {
  if (!value || !Number.isSafeInteger(quantity)) {
    return null;
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const scale = fraction.length;
  const result = BigInt(`${whole}${fraction}`) * BigInt(quantity);
  const resultText = result.toString().padStart(scale + 1, '0');
  const splitAt = resultText.length - scale;
  const formatted = scale
    ? `${resultText.slice(0, splitAt)}.${resultText.slice(splitAt)}`
    : resultText;

  return negative ? `-${formatted}` : formatted;
}

export function parseOptionalDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
