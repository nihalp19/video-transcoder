import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PollerModule } from './poller/poller.module';
import { TranscoderModule } from './transcoder/transcoder.module';

@Module({
  imports: [PollerModule, TranscoderModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
