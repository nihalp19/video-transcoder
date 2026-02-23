export interface VideoJob {
  videoName: string;
  fileType: string;
  pathLocationOrUrl: string;
  size: number; // in bytes
  resolution: string; // e.g., "1920x1080"
}
