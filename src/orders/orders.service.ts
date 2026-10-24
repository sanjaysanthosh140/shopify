import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListOrdersQueryDto } from './orders.dto';

function decimalToString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function serializeOrder(order: any) {
  return {
    id: order.id,
    shopifyId: order.shopifyId,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    orderedAt: order.orderedAt,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    currencyCode: order.currencyCode,
    subtotal: decimalToString(order.subtotal),
    total: decimalToString(order.total),
    tax: decimalToString(order.tax),
    shipping: decimalToString(order.shipping),
    cancelledAt: order.cancelledAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    lineItems: order.lineItems?.map((item: any) => ({
      id: item.id,
      shopifyId: item.shopifyId,
      shopifyProductId: item.shopifyProductId,
      shopifyVariantId: item.shopifyVariantId,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: decimalToString(item.unitPrice),
      lineTotal: decimalToString(item.lineTotal),
    })),
  };
}

function dateRange(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }

  return date;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListOrdersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const orderedAt = {
      ...(dateRange(query.from, false) ? { gte: dateRange(query.from, false) } : {}),
      ...(dateRange(query.to, true) ? { lte: dateRange(query.to, true) } : {}),
    };

    const where = {
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: 'insensitive' as const } },
              { customerName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.financialStatus
        ? { financialStatus: query.financialStatus }
        : {}),
      ...(query.fulfillmentStatus
        ? { fulfillmentStatus: query.fulfillmentStatus }
        : {}),
      ...(Object.keys(orderedAt).length ? { orderedAt } : {}),
    };

    const total = await this.prisma.order.count({ where });
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { orderedAt: query.sort ?? 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const allTotal = await this.prisma.order.count();
    const paid = await this.prisma.order.count({ where: { financialStatus: 'PAID' } });
    const pending = await this.prisma.order.count({ where: { financialStatus: 'PENDING' } });
    const fulfilled = await this.prisma.order.count({ where: { fulfillmentStatus: 'FULFILLED' } });
    const needsAttention = await this.prisma.order.count({
      where: {
        OR: [
          { financialStatus: { in: ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'] } },
          { fulfillmentStatus: { in: ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'ON_HOLD'] } },
        ],
      },
    });

    return {
      success: true,
      data: orders.map(serializeOrder),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      stats: {
        total: allTotal,
        paid,
        pending,
        fulfilled,
        needsAttention,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [{ id }, { shopifyId: id }],
      },
      include: {
        lineItems: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return {
      success: true,
      data: serializeOrder(order),
    };
  }
}
