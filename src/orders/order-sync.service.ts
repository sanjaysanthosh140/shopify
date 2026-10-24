import { Injectable, Logger } from '@nestjs/common';
import { ShopifyService } from '../shopify/shopify.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  multiplyMoney,
  normalizeMoney,
  normalizeShopifyId,
  NormalizedOrder,
  NormalizedOrderItem,
  parseOptionalDate,
} from './order.types';

interface GraphQLMoneySet {
  shopMoney?: { amount?: string };
}

interface GraphQLLineItem {
  id: string;
  title?: string;
  name?: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  originalUnitPriceSet?: GraphQLMoneySet;
  originalTotalSet?: GraphQLMoneySet;
  variant?: { id?: string; title?: string | null } | null;
  product?: { id?: string } | null;
}

interface GraphQLOrder {
  id: string;
  name?: string;
  createdAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode: string;
  currentSubtotalPriceSet?: GraphQLMoneySet;
  currentTotalPriceSet?: GraphQLMoneySet;
  currentTotalTaxSet?: GraphQLMoneySet;
  currentShippingPriceSet?: GraphQLMoneySet;
  cancelledAt?: string | null;
  customer?: {
    id?: string;
    displayName?: string | null;
    email?: string | null;
  } | null;
  lineItems: {
    nodes: GraphQLLineItem[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface GraphQLOrdersResponse {
  orders: {
    nodes: GraphQLOrder[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface GraphQLLineItemsResponse {
  node: {
    lineItems: {
      nodes: GraphQLLineItem[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

export interface SyncSummary {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  pages: number;
}

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        currencyCode
        currentSubtotalPriceSet { shopMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        currentTotalTaxSet { shopMoney { amount } }
        currentShippingPriceSet { shopMoney { amount } }
        cancelledAt
        customer { id displayName email }
        lineItems(first: 250) {
          nodes {
            id
            title
            name
            variantTitle
            sku
            quantity
            originalUnitPriceSet { shopMoney { amount } }
            originalTotalSet { shopMoney { amount } }
            variant { id title }
            product { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const LINE_ITEMS_QUERY = `
  query OrderLineItems($id: ID!, $after: String) {
    node(id: $id) {
      ... on Order {
        lineItems(first: 250, after: $after) {
          nodes {
            id
            title
            name
            variantTitle
            sku
            quantity
            originalUnitPriceSet { shopMoney { amount } }
            originalTotalSet { shopMoney { amount } }
            variant { id title }
            product { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyService,
  ) {}

  async syncOrders(pageSize = 50, maxPages = 100): Promise<SyncSummary> {
    const summary: SyncSummary = {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      pages: 0,
    };
    let after: string | null = null;

    do {
      const response: GraphQLOrdersResponse = await this.shopify.requestGraphQL<GraphQLOrdersResponse>(
        ORDERS_QUERY,
        { first: pageSize, after },
      );
      summary.pages += 1;

      for (const order of response.orders.nodes) {
        summary.fetched += 1;
        try {
          const completeOrder = await this.expandLineItems(order);
          const result = await this.upsertOrder(this.mapGraphQLOrder(completeOrder));
          if (result.created) {
            summary.created += 1;
          } else {
            summary.updated += 1;
          }
        } catch {
          summary.skipped += 1;
          this.logger.warn('Skipped a Shopify order that could not be mapped or stored');
        }
      }

      after = response.orders.pageInfo.hasNextPage
        ? response.orders.pageInfo.endCursor
        : null;
    } while (after && summary.pages < maxPages);

    return summary;
  }

  async syncWebhookOrder(payload: Record<string, any>) {
    return this.upsertOrder(this.mapWebhookOrder(payload));
  }

  private async expandLineItems(order: GraphQLOrder): Promise<GraphQLOrder> {
    if (!order.lineItems.pageInfo.hasNextPage) {
      return order;
    }

    const nodes = [...order.lineItems.nodes];
    let after = order.lineItems.pageInfo.endCursor;
    let hasNextPage = true;

    while (hasNextPage && after) {
      const response: GraphQLLineItemsResponse =
        await this.shopify.requestGraphQL<GraphQLLineItemsResponse>(
          LINE_ITEMS_QUERY,
          { id: order.id, after },
        );
      const page = response.node?.lineItems;
      if (!page) {
        break;
      }
      nodes.push(...page.nodes);
      hasNextPage = page.pageInfo.hasNextPage;
      after = page.pageInfo.endCursor;
    }

    return {
      ...order,
      lineItems: {
        nodes,
        pageInfo: { hasNextPage, endCursor: after },
      },
    };
  }

  async upsertOrder(input: NormalizedOrder) {
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.order.findUnique({
        where: { shopifyId: input.shopifyId },
      });

      const order = await transaction.order.upsert({
        where: { shopifyId: input.shopifyId },
        create: {
          shopifyId: input.shopifyId,
          orderNumber: input.orderNumber,
          customerId: input.customerId,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          orderedAt: input.orderedAt,
          financialStatus: input.financialStatus,
          fulfillmentStatus: input.fulfillmentStatus,
          currencyCode: input.currencyCode,
          subtotal: input.subtotal,
          total: input.total,
          tax: input.tax,
          shipping: input.shipping,
          cancelledAt: input.cancelledAt,
        },
        update: {
          orderNumber: input.orderNumber || existing?.orderNumber,
          customerId: input.customerId ?? existing?.customerId,
          customerName: input.customerName ?? existing?.customerName,
          customerEmail: input.customerEmail ?? existing?.customerEmail,
          orderedAt: input.orderedAt,
          financialStatus: input.financialStatus ?? existing?.financialStatus,
          fulfillmentStatus:
            input.fulfillmentStatus ?? existing?.fulfillmentStatus,
          currencyCode: input.currencyCode || existing?.currencyCode,
          subtotal: input.subtotal ?? existing?.subtotal,
          total: input.total ?? existing?.total,
          tax: input.tax ?? existing?.tax,
          shipping: input.shipping ?? existing?.shipping,
          cancelledAt: input.cancelledAt ?? existing?.cancelledAt,
        },
      });

      for (const item of input.lineItems) {
        await this.upsertLineItem(transaction, order.id, item);
      }

      if (input.completeLineItems) {
        const itemIds = input.lineItems.map((item) => item.shopifyId);
        await transaction.orderItem.deleteMany({
          where: {
            orderId: order.id,
            ...(itemIds.length ? { shopifyId: { notIn: itemIds } } : {}),
          },
        });
      }

      return { created: !existing, orderId: order.id };
    });
  }

  private async upsertLineItem(transaction: any, orderId: string, item: NormalizedOrderItem) {
    const existing = await transaction.orderItem.findUnique({
      where: { shopifyId: item.shopifyId },
    });

    await transaction.orderItem.upsert({
      where: { shopifyId: item.shopifyId },
      create: {
        shopifyId: item.shopifyId,
        orderId,
        shopifyProductId: item.shopifyProductId,
        shopifyVariantId: item.shopifyVariantId,
        productTitle: item.productTitle,
        variantTitle: item.variantTitle,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      },
      update: {
        orderId,
        shopifyProductId: item.shopifyProductId ?? existing?.shopifyProductId,
        shopifyVariantId: item.shopifyVariantId ?? existing?.shopifyVariantId,
        productTitle: item.productTitle || existing?.productTitle,
        variantTitle: item.variantTitle ?? existing?.variantTitle,
        sku: item.sku ?? existing?.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? existing?.unitPrice,
        lineTotal: item.lineTotal ?? existing?.lineTotal,
      },
    });
  }

  private mapGraphQLOrder(order: GraphQLOrder): NormalizedOrder {
    return {
      shopifyId: normalizeShopifyId(order.id),
      orderNumber: order.name || normalizeShopifyId(order.id),
      customerId: order.customer?.id ? normalizeShopifyId(order.customer.id) : null,
      customerName: order.customer?.displayName ?? null,
      customerEmail: order.customer?.email ?? null,
      orderedAt: new Date(order.createdAt),
      financialStatus: order.displayFinancialStatus ?? null,
      fulfillmentStatus: order.displayFulfillmentStatus ?? null,
      currencyCode: order.currencyCode,
      subtotal: normalizeMoney(order.currentSubtotalPriceSet?.shopMoney?.amount),
      total: normalizeMoney(order.currentTotalPriceSet?.shopMoney?.amount),
      tax: normalizeMoney(order.currentTotalTaxSet?.shopMoney?.amount),
      shipping: normalizeMoney(order.currentShippingPriceSet?.shopMoney?.amount),
      cancelledAt: parseOptionalDate(order.cancelledAt),
      lineItems: order.lineItems.nodes.map((item) => this.mapGraphQLLineItem(item)),
      completeLineItems: !order.lineItems.pageInfo.hasNextPage,
    };
  }

  private mapGraphQLLineItem(item: GraphQLLineItem): NormalizedOrderItem {
    const unitPrice = normalizeMoney(item.originalUnitPriceSet?.shopMoney?.amount);
    return {
      shopifyId: normalizeShopifyId(item.id),
      shopifyProductId: item.product?.id ? normalizeShopifyId(item.product.id) : null,
      shopifyVariantId: item.variant?.id ? normalizeShopifyId(item.variant.id) : null,
      productTitle: item.title || item.name || 'Shopify item',
      variantTitle: item.variantTitle ?? item.variant?.title ?? null,
      sku: item.sku ?? null,
      quantity: item.quantity,
      unitPrice,
      lineTotal: normalizeMoney(item.originalTotalSet?.shopMoney?.amount) ??
        multiplyMoney(unitPrice, item.quantity),
    };
  }

  private mapWebhookOrder(payload: Record<string, any>): NormalizedOrder {
    const shopifyId = normalizeShopifyId(
      payload.admin_graphql_api_id ?? payload.id,
    );
    const orderedAt = parseOptionalDate(payload.created_at ?? payload.createdAt);
    if (!orderedAt) {
      throw new Error('Shopify webhook order is missing a valid creation date');
    }

    const customer = payload.customer ?? {};
    const customerName =
      customer.display_name ??
      customer.name ??
      ([customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
        null);
    const lineItems = Array.isArray(payload.line_items)
      ? payload.line_items.map((item: Record<string, any>) => {
          const quantity = Number.isSafeInteger(item.quantity)
            ? item.quantity
            : Number.parseInt(String(item.quantity ?? 0), 10);
          const unitPrice = normalizeMoney(item.price ?? item.original_unit_price);
          return {
            shopifyId: normalizeShopifyId(item.admin_graphql_api_id ?? item.id),
            shopifyProductId: item.product_id
              ? normalizeShopifyId(item.product_id)
              : item.product?.id
                ? normalizeShopifyId(item.product.id)
                : null,
            shopifyVariantId: item.variant_id
              ? normalizeShopifyId(item.variant_id)
              : item.variant?.id
                ? normalizeShopifyId(item.variant.id)
                : null,
            productTitle: item.title ?? item.name ?? 'Shopify item',
            variantTitle: item.variant_title ?? item.variant?.title ?? null,
            sku: item.sku ?? null,
            quantity: Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : 0,
            unitPrice,
            lineTotal: normalizeMoney(item.original_total_price) ??
              multiplyMoney(unitPrice, quantity),
          } satisfies NormalizedOrderItem;
        })
      : [];

    return {
      shopifyId,
      orderNumber: String(payload.name ?? payload.order_number ?? shopifyId),
      customerId: customer.admin_graphql_api_id
        ? normalizeShopifyId(customer.admin_graphql_api_id)
        : customer.id
          ? normalizeShopifyId(customer.id)
          : null,
      customerName,
      customerEmail: customer.email ?? payload.email ?? null,
      orderedAt,
      financialStatus: payload.financial_status
        ? String(payload.financial_status).toUpperCase()
        : null,
      fulfillmentStatus: payload.fulfillment_status
        ? String(payload.fulfillment_status).toUpperCase()
        : null,
      currencyCode: String(payload.currency ?? payload.presentment_currency ?? 'UNKNOWN'),
      subtotal: normalizeMoney(
        payload.current_subtotal_price ?? payload.subtotal_price,
      ),
      total: normalizeMoney(payload.current_total_price ?? payload.total_price),
      tax: normalizeMoney(payload.current_total_tax ?? payload.total_tax),
      shipping: normalizeMoney(
        payload.current_total_shipping_price_set?.shop_money?.amount ??
          payload.total_shipping_price_set?.shop_money?.amount ??
          payload.total_shipping_price,
      ),
      cancelledAt: parseOptionalDate(payload.cancelled_at),
      lineItems,
      completeLineItems: true,
    };
  }
}
