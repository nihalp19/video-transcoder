import { Module } from '@nestjs/common';
import { PollerService } from './poller.service';
import { PollerController } from './poller.controller';
import { TranscoderModule } from '../transcoder/transcoder.module';

@Module({
  imports: [TranscoderModule],
  controllers: [PollerController],
  providers: [PollerService],
  exports: [PollerService],
})
export class PollerModule {}
