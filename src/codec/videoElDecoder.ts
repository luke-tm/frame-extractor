/**
 * videoElDecoder.ts
 * Fallback decoder using hidden <video> + requestVideoFrameCallback.
 * Alpha is NOT preserved — caller should have surfaced a warning already.
 */

import type { DecodedFrame, VideoMetadata } from '../types';

export type OnFrameCallback = (frame: DecodedFrame) => void;

export class VideoElementDecoder {
  private video: HTMLVideoElement;
  private objectUrl: string | null = null;
  private onFrame: OnFrameCallback;
  private frameIndex = 0;
  private resolveSeek: (() => void) | null = null;

  constructor(onFrame: OnFrameCallback) {
    this.onFrame = onFrame;
    this.video = document.createElement('video');
    this.video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    this.video.muted = true;
    this.video.playsInline = true;
    document.body.appendChild(this.video);
  }

  async load(file: File): Promise<Pick<VideoMetadata, 'width' | 'height' | 'duration' | 'frameCount' | 'fps'>> {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.video.src = this.objectUrl;

    return new Promise((resolve, reject) => {
      this.video.onloadedmetadata = () => {
        resolve({
          width: this.video.videoWidth,
          height: this.video.videoHeight,
          duration: this.video.duration * 1_000_000,
          // <video> doesn't expose frame count; estimate from duration × fps
          frameCount: 0, // Will be estimated
          fps: 0,        // Will be estimated
        });
      };
      this.video.onerror = () => reject(new Error('Video load failed'));
    });
  }

  /** Capture the current video frame to an ImageBitmap */
  async captureCurrentFrame(): Promise<DecodedFrame> {
    const canvas = new OffscreenCanvas(this.video.videoWidth, this.video.videoHeight);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(this.video, 0, 0);
    const bitmap = await createImageBitmap(canvas);

    return {
      index: this.frameIndex,
      timestamp: this.video.currentTime * 1_000_000,
      imageBitmap: bitmap,
      width: this.video.videoWidth,
      height: this.video.videoHeight,
    };
  }

  /** Seek to a specific time and capture */
  async seekToTime(timeSeconds: number): Promise<DecodedFrame> {
    this.video.currentTime = timeSeconds;
    await new Promise<void>((resolve) => {
      this.video.onseeked = () => resolve();
    });
    return this.captureCurrentFrame();
  }

  /** Step through frames using requestVideoFrameCallback */
  captureNextFrame(): Promise<DecodedFrame> {
    return new Promise((resolve) => {
      (this.video as any).requestVideoFrameCallback(
        (_now: number, meta: { mediaTime: number }) => {
          const canvas = new OffscreenCanvas(this.video.videoWidth, this.video.videoHeight);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(this.video, 0, 0);

          createImageBitmap(canvas).then((bitmap) => {
            const frame: DecodedFrame = {
              index: this.frameIndex++,
              timestamp: meta.mediaTime * 1_000_000,
              imageBitmap: bitmap,
              width: this.video.videoWidth,
              height: this.video.videoHeight,
            };
            this.onFrame(frame);
            resolve(frame);
          });
        }
      );
    });
  }

  dispose(): void {
    this.video.pause();
    this.video.src = '';
    this.video.remove();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
