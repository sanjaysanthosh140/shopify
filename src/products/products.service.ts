
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    shopifyId: string;
    title: string;
    handle?: string;
  }) {
    return this.prisma.product.create({
      data,
    });
  }
}
