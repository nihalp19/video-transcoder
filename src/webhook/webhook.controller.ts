import { Controller, Post, Body, Logger, HttpCode, Get } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() event: any): Promise<{ success: boolean; message: string }> {
    this.logger.log('🔔 Webhook triggered by MinIO');
    
    try {
      await this.webhookService.handleMinioEvent(event);
      return {
        success: true,
        message: 'Event processed successfully',
      };
    } catch (error) {
      this.logger.error('❌ Failed to process webhook:', error);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @Get('status')
  async getStatus(): Promise<{ queueLength: number }> {
    const queueLength = await this.webhookService.getQueueLength();
    return { queueLength };
  }
}
