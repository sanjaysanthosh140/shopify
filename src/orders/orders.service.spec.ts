import { jest } from '@jest/globals';
import { OrdersService } from './orders.service';

describe('OrdersService filtering', () => {
  it('passes search, status, date, and pagination filters to Prisma', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      order: { count, findMany },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const service = new OrdersService(prisma as any);

    await service.findAll({
      page: 2,
      pageSize: 10,
      search: 'Ada',
      financialStatus: 'PAID',
      fulfillmentStatus: 'UNFULFILLED',
      from: '2026-10-01',
      to: '2026-10-24',
      sort: 'asc',
    });

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        OR: expect.any(Array),
        orderedAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
      }),
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, orderBy: { orderedAt: 'asc' } }),
    );
  });
});
