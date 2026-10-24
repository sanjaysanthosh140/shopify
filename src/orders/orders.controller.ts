import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ListOrdersQueryDto, SyncOrdersDto } from './orders.dto';
import { OrderSyncService } from './order-sync.service';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly sync: OrderSyncService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  findAll(@Query() query: ListOrdersQueryDto) {
    return this.orders.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
  }

  @Post('sync')
  syncOrders(
    @Headers('x-sync-key') syncKey: string | undefined,
    @Body() body: SyncOrdersDto,
  ) {
    this.assertSyncAuthorization(syncKey);
    return this.sync.syncOrders(body.pageSize, body.maxPages).then((summary) => ({
      success: true,
      message: 'Shopify orders synchronized',
      summary,
    }));
  }

  private assertSyncAuthorization(syncKey: string | undefined) {
    const configuredKey = this.config.get<string>('SYNC_ADMIN_KEY');
    if (!configuredKey) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new UnauthorizedException('Order synchronization is not configured');
      }
      return;
    }

    const provided = Buffer.from(syncKey ?? '');
    const expected = Buffer.from(configuredKey);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException('Invalid synchronization key');
    }
  }
}
