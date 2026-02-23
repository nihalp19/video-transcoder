import { Injectable } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TranscoderService {

  async transcode(inputPath: string, outputBaseDir: string): Promise<void> {
    return new Promise((resolve, reject) => {

      if (!fs.existsSync(outputBaseDir)) {
        fs.mkdirSync(outputBaseDir, { recursive: true });
      }

      ffmpeg(inputPath)
        .setFfmpegPath(ffmpegPath)
        .outputOptions([
          '-preset veryfast',
          '-g 48',
          '-sc_threshold 0',
          '-map 0:v',
          '-map 0:a?',
          '-map 0:v',
          '-map 0:a?',
          '-map 0:v',
          '-map 0:a?',
          '-filter:v:0 scale=640:360',
          '-filter:v:1 scale=1280:720',
          '-filter:v:2 scale=1920:1080',
          '-b:v:0 800k',
          '-b:v:1 2800k',
          '-b:v:2 5000k',
          '-f hls',
          '-hls_time 6',
          '-hls_playlist_type vod',
          '-master_pl_name master.m3u8',
          '-var_stream_map v:0,a:0 v:1,a:1 v:2,a:2',
        ])
        .output(path.join(outputBaseDir, 'hls_%v/index.m3u8'))
        .on('end', () => {
          console.log('✅ Transcoding finished');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Transcoding error:', err);
          reject(err);
        })
        .run();
    });
  }
}