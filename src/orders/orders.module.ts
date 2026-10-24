import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopifyModule } from '../shopify/shopify.module';
import { OrderSyncService } from './order-sync.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, ShopifyModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderSyncService],
  exports: [OrderSyncService],
})
export class OrdersModule {}
