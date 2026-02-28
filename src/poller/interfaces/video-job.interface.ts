export interface VideoJob {
  videoName: string;
  fileType: string;
  pathLocationOrUrl: string;
  bucketName: string;
  objectKey: string;
  size: number; // in bytes
  resolution: string; // e.g., "1920x1080"
}
