import { Controller, Post, Body } from '@nestjs/common';
import { PollerService } from './poller.service';
import type { VideoJob } from './interfaces/video-job.interface';

@Controller('poller')
export class PollerController {
  constructor(private readonly pollerService: PollerService) {}

  @Post('add-job')
  async addJob(@Body() job: VideoJob) {
    await this.pollerService.addTestJob(job);
    return {
      success: true,
      message: `Job added to queue: ${job.videoName}`,
    };
  }
}
