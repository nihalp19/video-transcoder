import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { TranscoderService } from '../transcoder/transcoder.service';
import { VideoJob } from './interfaces/video-job.interface';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class PollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private redisClient: Redis;
  private isPolling = false;
  private isProcessing = false;
  private readonly QUEUE_NAME = 'video-transcoding-queue';
  private readonly REDIS_URL = 'redis://default:ZkltzDmBatUBfde4dPhoveqU0VZXQbLC@redis-10056.c267.us-east-1-4.ec2.cloud.redislabs.com:10056';
  
  constructor(private readonly transcoderService: TranscoderService) {}

  async onModuleInit() {
    this.logger.log('Initializing Redis Poller Service...');
    
    // Initialize Redis client
    this.redisClient = new Redis(this.REDIS_URL);
    
    this.redisClient.on('connect', () => {
      this.logger.log('Connected to Redis');
    });
    
    this.redisClient.on('error', (err) => {
      this.logger.error('Redis connection error:', err);
    });
    
    // Start polling
    this.startPolling();
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Redis Poller Service...');
    this.isPolling = false;
    
    if (this.redisClient) {
      await this.redisClient.quit();
      this.logger.log('Redis connection closed');
    }
  }

  private async startPolling() {
    this.isPolling = true;
    this.logger.log('🔄 Started polling Redis queue for video transcoding jobs...');
    
    while (this.isPolling) {
      try {
        // Only poll if not currently processing another job (serial processing)
        if (!this.isProcessing) {
          const job = await this.pollJob();
          
          if (job) {
            await this.processJob(job);
          } else {
            // Wait before next poll if no job found
            await this.sleep(2000); // 2 seconds
          }
        } else {
          // Wait a bit before checking again
          await this.sleep(500);
        }
      } catch (error) {
        this.logger.error('Error in polling loop:', error);
        await this.sleep(5000); // Wait 5 seconds on error before retrying
      }
    }
  }

  private async pollJob(): Promise<VideoJob | null> {
    try {
      // Use LPOP to get the next job from the queue
      const jobData = await this.redisClient.lpop(this.QUEUE_NAME);
      
      if (!jobData) {
        return null;
      }
      
      // Parse the job data
      const job: VideoJob = JSON.parse(jobData);
      this.logger.log(`📦 New job received: ${job.videoName}`);
      
      return job;
    } catch (error) {
      this.logger.error('Error polling job from Redis:', error);
      return null;
    }
  }

  private async processJob(job: VideoJob) {
    this.isProcessing = true;
    
    try {
      this.logger.log(`🎬 Processing video: ${job.videoName}`);
      this.logger.log(`   File Type: ${job.fileType}`);
      this.logger.log(`   Location: ${job.pathLocationOrUrl}`);
      this.logger.log(`   Size: ${(job.size / (1024 * 1024)).toFixed(2)} MB`);
      this.logger.log(`   Resolution: ${job.resolution}`);
      
      // Determine the output directory
      const videoNameWithoutExt = path.parse(job.videoName).name;
      const outputDir = path.join(process.cwd(), 'output', videoNameWithoutExt);
      
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Call transcoder service
      await this.transcoderService.transcode(job.pathLocationOrUrl, outputDir);
      
      this.logger.log(`✅ Successfully transcoded: ${job.videoName}`);
      this.logger.log(`   Output location: ${outputDir}`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to process job for ${job.videoName}:`, error);
      // Optionally: push to a dead-letter queue or retry queue
    } finally {
      this.isProcessing = false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Manual method to add a test job (optional - for testing)
  async addTestJob(job: VideoJob): Promise<void> {
    await this.redisClient.rpush(this.QUEUE_NAME, JSON.stringify(job));
    this.logger.log(`Added test job to queue: ${job.videoName}`);
  }
}
