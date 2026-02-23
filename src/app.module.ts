import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PollerService } from './poller/poller.service';
import { PollerController } from './poller/poller.controller';
import { PollerModule } from './poller/poller.module';
import { TranscoderModule } from './transcoder/transcoder.module';

@Module({
  imports: [ PollerModule, TranscoderModule],
  controllers: [AppController, PollerController],
  providers: [AppService, PollerService],
})
export class AppModule {}
