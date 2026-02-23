import { Module } from '@nestjs/common';
import { TranscoderService } from './transcoder.service';
import { TranscoderController } from './transcoder.controller';

@Module({
  providers: [TranscoderService],
  controllers: [TranscoderController],
  exports: [TranscoderService],
})
export class TranscoderModule {}
