// Shared types across the app

export type DecodePathType = 'webcodecs' | 'video-element' | 'gif-imagedecoder' | 'gif-gifuct';

export interface FrameEntry {
  index: number;
  timestamp: number; // microseconds
  isKeyframe: boolean;
  duration: number;  // microseconds
}

export interface VideoMetadata {
  width: number;
  height: number;
  frameCount: number;
  duration: number;       // microseconds
  fps: number;
  codec: string;
  hasAlpha: boolean;
  rotation: 0 | 90 | 180 | 270;
  isHDR: boolean;
  decodePath: DecodePathType;
  originalName: string;
}

export interface DecodedFrame {
  index: number;
  timestamp: number;
  imageBitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface ExportOptions {
  format: 'jpeg' | 'png' | 'webp';
  quality: number;         // 0.1–1.0 (used for jpeg/webp)
  bgColor: string;         // for jpeg alpha flatten, e.g. '#ffffff'
}

export interface BatchExportOptions extends ExportOptions {
  startFrame: number;
  endFrame: number;
}

export type AppEvent =
  | { type: 'file-selected'; file: File }
  | { type: 'metadata-ready'; metadata: VideoMetadata }
  | { type: 'frame-decoded'; frame: DecodedFrame }
  | { type: 'seek'; frameIndex: number }
  | { type: 'decode-error'; frameIndex: number; error: Error }
  | { type: 'memory-warning' }
  | { type: 'hdr-warning' };

// WebCodecs global augmentations not yet in TS lib
declare global {
  interface Window {
    __BASE__: string;
  }
}
