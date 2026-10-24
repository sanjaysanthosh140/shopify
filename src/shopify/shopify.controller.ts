
import { Controller, Get } from '@nestjs/common';
import { ShopifyService } from './shopify.service';

@Controller('shopify')
export class ShopifyController {
  constructor(private readonly shopifyService: ShopifyService) {}

  @Get('test')
  async testConnection() {
    const shop = await this.shopifyService.getShopInfo();

    return {
      success: true,
      message: 'Shopify connection successful',
      shop,
    };
  }
}
