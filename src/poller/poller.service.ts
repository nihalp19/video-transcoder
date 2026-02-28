import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { TranscoderService } from '../transcoder/transcoder.service';
import { VideoJob } from './interfaces/video-job.interface';
import * as path from 'path';
import * as fs from 'fs';
import { Client as MinioClient } from 'minio';
import * as chokidar from 'chokidar';

@Injectable()
export class PollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollerService.name);
  private redisClient: Redis;
  private minioClient: MinioClient;
  private isPolling = false;
  private isProcessing = false;
  private readonly QUEUE_NAME = 'video-transcoding-queue';
  private readonly REDIS_URL = 'redis://default:ZkltzDmBatUBfde4dPhoveqU0VZXQbLC@redis-10056.c267.us-east-1-4.ec2.cloud.redislabs.com:10056';
  
  constructor(private readonly transcoderService: TranscoderService) {
    // Initialize MinIO client
    this.minioClient = new MinioClient({
      endPoint: '127.0.0.1',
      port: 9000,
      useSSL: false,
      accessKey: 'minioadmin', // Change this to your MinIO access key
      secretKey: 'minioadmin', // Change this to your MinIO secret key
    });
  }

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
      this.logger.log(`   Bucket: ${job.bucketName}`);
      this.logger.log(`   Object Key: ${job.objectKey}`);
      this.logger.log(`   Size: ${(job.size / (1024 * 1024)).toFixed(2)} MB`);
      this.logger.log(`   Resolution: ${job.resolution}`);
      
      // Generate presigned URL from MinIO (valid for 1 hour)
      this.logger.log(`🔗 Generating presigned URL from MinIO...`);
      const presignedUrl = await this.minioClient.presignedGetObject(
        job.bucketName,
        job.objectKey,
        3600 // 1 hour validity
      );
      this.logger.log(`✅ Presigned URL generated`);
      
      // Determine the output directory
      const videoNameWithoutExt = path.parse(job.videoName).name;
      const outputDir = path.join('C:\\video-transcoder-output', videoNameWithoutExt);
      
      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const outputBucket = 'transcoded-videos';
      const uploadedFiles = new Set<string>();
      
      // Setup file watcher for progressive upload
      this.logger.log(`👀 Starting progressive upload watcher...`);
      const watcher = chokidar.watch(outputDir, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100
        }
      });
      
      // Handle new files
      watcher.on('add', async (filePath) => {
        const fileName = path.basename(filePath);
        // Use POSIX normalization for HLS paths
        const relativePath = path.relative(outputDir, filePath).split(path.sep).join('/');
        
        // Skip if already uploaded
        if (uploadedFiles.has(filePath)) return;
        
        try {
          // Priority 1: Upload master.m3u8 immediately
          if (fileName === 'master.m3u8') {
            this.logger.log(`📤 [PRIORITY] Rewriting and uploading master.m3u8...`);
            await this.rewriteMasterPlaylist(filePath);
            await this.uploadFileToMinio(
              outputBucket,
              `${videoNameWithoutExt}/master.m3u8`,
              filePath
            );
            uploadedFiles.add(filePath);
            this.logger.log(`   ✅ Uploaded master.m3u8`);
          }
          // Priority 2: Upload segments and init files
          else if (fileName.endsWith('.m4s') || fileName.endsWith('.ts') || fileName.endsWith('init.mp4')) {
            this.logger.log(`📦 Uploading segment: ${relativePath}`);
            const objectName = `${videoNameWithoutExt}/${relativePath}`;
            await this.uploadFileToMinio(outputBucket, objectName, filePath);
            uploadedFiles.add(filePath);
            this.logger.log(`   ✅ ${relativePath}`);
            // After segment upload, re-upload updated index.m3u8
            const variantDir = path.dirname(filePath);
            const indexPath = path.join(variantDir, 'index.m3u8');
            if (fs.existsSync(indexPath)) {
              const indexRelative = path.relative(outputDir, indexPath).split(path.sep).join('/');
              this.logger.log(`📝 Rewriting and re-uploading updated ${indexRelative}...`);
              await this.rewriteVariantPlaylist(indexPath, variantDir);
              await this.uploadFileToMinio(
                outputBucket,
                `${videoNameWithoutExt}/${indexRelative}`,
                indexPath
              );
              this.logger.log(`   ✅ Updated ${indexRelative}`);
            }
          }
        } catch (error) {
          this.logger.error(`❌ Failed to upload ${relativePath}:`, error);
        }
      });
      
      // Call transcoder service with presigned URL (ffmpeg will stream directly)
      this.logger.log(`🎞️  Starting transcoding (streaming from MinIO)...`);
      await this.transcoderService.transcode(presignedUrl, outputDir);
      
      // Wait a bit for final files to be detected and uploaded
      await this.sleep(2000);
      
      // Stop watching
      await watcher.close();
      
      this.logger.log(`✅ Successfully transcoded and uploaded: ${job.videoName}`);
      this.logger.log(`   Total files uploaded: ${uploadedFiles.size}`);
      this.logger.log(`   MinIO location: ${outputBucket}/${videoNameWithoutExt}`);
      
      // Clean up local files after upload
      this.logger.log(`🗑️  Cleaning up local files...`);
      this.deleteDirectory(outputDir);
      this.logger.log(`✅ Cleanup complete`);
        // Log streamable MinIO URL for player
        const streamUrl = `http://127.0.0.1:9000/transcoded-videos/${videoNameWithoutExt}/master.m3u8`;
        this.logger.log(`🎬 Stream URL for player: ${streamUrl}`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to process job for ${job.videoName}:`, error);
      // Optionally: push to a dead-letter queue or retry queue
    } finally {
      this.isProcessing = false;
    }
  }

  private async uploadFileToMinio(
    bucket: string,
    objectName: string,
    filePath: string,
  ): Promise<void> {
    // Ensure bucket exists
    const bucketExists = await this.minioClient.bucketExists(bucket);
    if (!bucketExists) {
      await this.minioClient.makeBucket(bucket, 'us-east-1');
      this.logger.log(`📦 Created bucket: ${bucket}`);
    }

    await this.minioClient.fPutObject(bucket, objectName, filePath, {
      'Content-Type': this.getContentType(filePath),
    });
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: { [key: string]: string } = {
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.m4s': 'video/iso.segment',
      '.mp4': 'video/mp4',
      '.ts': 'video/mp2t',
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  private deleteDirectory(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
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

  private async rewriteMasterPlaylist(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf8');
    // Replace Windows path separators with Unix-style
    content = content.replace(/\\/g, '/');
    fs.writeFileSync(filePath, content, 'utf8');
  }

  /**
   * Rewrites variant playlist to use correct init segment and Unix-style paths.
   */
  private async rewriteVariantPlaylist(indexPath: string, variantDir: string): Promise<void> {
    if (!fs.existsSync(indexPath)) return;
    let content = fs.readFileSync(indexPath, 'utf8');
    // Replace Windows path separators with Unix-style
    content = content.replace(/\\/g, '/');
    // Determine variant index (e.g., hls_0 → 0)
    const match = variantDir.match(/hls_(\d+)/);
    const variantIdx = match ? match[1] : '0';
    // Fix init segment reference
    content = content.replace(/#EXT-X-MAP:URI="init_\d*\.mp4"/g, `#EXT-X-MAP:URI="init_${variantIdx}.mp4"`);
    fs.writeFileSync(indexPath, content, 'utf8');
  }
}