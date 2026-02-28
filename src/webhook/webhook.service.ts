import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { MinioEvent } from './interfaces/minio-event.interface';
import { VideoJob } from '../poller/interfaces/video-job.interface';
import * as path from 'path';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private redisClient: Redis;
  private readonly QUEUE_NAME = 'video-transcoding-queue';
  private readonly REDIS_URL = 'redis://default:ZkltzDmBatUBfde4dPhoveqU0VZXQbLC@redis-10056.c267.us-east-1-4.ec2.cloud.redislabs.com:10056';
  private readonly MINIO_ENDPOINT = 'http://127.0.0.1:9000';

  constructor() {
    this.initializeRedis();
  }

  private initializeRedis() {
    this.redisClient = new Redis(this.REDIS_URL);
    
    this.redisClient.on('connect', () => {
      this.logger.log('✅ Webhook Service connected to Redis');
    });
    
    this.redisClient.on('error', (err) => {
      this.logger.error('❌ Redis connection error:', err);
    });
  }

  async handleMinioEvent(event: MinioEvent): Promise<void> {
    try {
      this.logger.log('📥 Received MinIO webhook event');
      
      // Process each record in the event
      for (const record of event.Records) {
        // Only process object creation events
        if (record.eventName.startsWith('s3:ObjectCreated:')) {
          await this.processVideoUpload(record);
        }
      }
    } catch (error) {
      this.logger.error('❌ Error handling MinIO event:', error);
      throw error;
    }
  }

  private async processVideoUpload(record: any): Promise<void> {
    const bucketName = record.s3.bucket.name;
    const objectKey = record.s3.object.key;
    const fileSize = record.s3.object.size;
    const contentType = record.s3.object.contentType;

    this.logger.log(`🎬 New video detected: ${objectKey}`);
    this.logger.log(`   Bucket: ${bucketName}`);
    this.logger.log(`   Size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
    this.logger.log(`   Type: ${contentType}`);

    // Extract video name from object key
    const videoName = path.basename(objectKey);
    const fileExtension = path.extname(objectKey).toLowerCase();

    // Create video job
    const videoJob: VideoJob = {
      videoName: videoName,
      fileType: fileExtension.replace('.', ''),
      pathLocationOrUrl: `${this.MINIO_ENDPOINT}/${bucketName}/${objectKey}`,
      bucketName: bucketName,
      objectKey: objectKey,
      size: fileSize,
      resolution: 'auto', // Will be detected by ffmpeg
    };

    // Push to Redis queue
    await this.redisClient.rpush(this.QUEUE_NAME, JSON.stringify(videoJob));
    
    this.logger.log(`✅ Job added to Redis queue: ${videoName}`);
    this.logger.log(`   Queue: ${this.QUEUE_NAME}`);
    this.logger.log(`   Path: ${videoJob.pathLocationOrUrl}`);
  }

  async getQueueLength(): Promise<number> {
    return await this.redisClient.llen(this.QUEUE_NAME);
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
      this.logger.log('🔌 Redis connection closed');
    }
  }
}
