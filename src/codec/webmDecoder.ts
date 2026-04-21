/**
 * webmDecoder.ts
 *
 * WebM is a Matroska-based container — mp4box.js does not parse it.
 *
 * Strategy:
 *   Chrome/Firefox: VideoDecoder is available, but WebM demuxing requires a
 *   Matroska parser we don't want to ship. Instead, use the browser's native
 *   <video> element (which can play WebM natively on these browsers) combined
 *   with requestVideoFrameCallback for frame-accurate stepping.
 *
 *   iOS Safari: Does not play WebM at all. We detect this and surface a clear
 *   error rather than silently failing.
 *
 * Alpha preservation:
 *   VP9 with alpha in a WebM container IS supported in Chrome via WebCodecs
 *   (chrome 108+), but demuxing the alpha track from Matroska requires a full
 *   Matroska parser. The <video> element path composites alpha away.
 *   We show a note about this limitation.
 *
 * Frame accuracy:
 *   requestVideoFrameCallback fires once per rendered frame during playback.
 *   We play at 0.01× speed and collect frames, then build the index.
 *   For seeking, we seek to the computed timestamp and capture.
 */

import type { DecodedFrame, VideoMetadata } from '../types';

export interface WebMInfo {
  width: number;
  height: number;
  duration: number;   // microseconds
  fps: number;        // estimated
  frameCount: number; // estimated
}

export type OnWebMFrameCallback = (frame: DecodedFrame) => void;

export class WebMDecoder {
  private video: HTMLVideoElement;
  private objectUrl: string | null = null;
  private readonly onFrame: OnWebMFrameCallback;
  private frameIdx = 0;

  constructor(onFrame: OnWebMFrameCallback) {
    this.onFrame = onFrame;
    this.video = document.createElement('video');
    this.video.style.cssText =
      'position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;opacity:0.001;pointer-events:none;';
    this.video.muted = true;
    this.video.playsInline = true;
    document.body.appendChild(this.video);
  }

  /** Check whether this browser can play WebM at all */
  static canPlay(): boolean {
    const v = document.createElement('video');
    const support = v.canPlayType('video/webm; codecs="vp9"');
    return support === 'probably' || support === 'maybe';
  }

  async load(file: File): Promise<WebMInfo> {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.video.src = this.objectUrl;
    this.video.load();

    await new Promise<void>((resolve, reject) => {
      this.video.onloadedmetadata = () => resolve();
      this.video.onerror = () => reject(
        new Error(`Browser cannot play this WebM file. ` +
          `On iOS Safari, WebM is not supported — convert to MP4 first.`)
      );
    });

    // Estimate frame count: seek to near-end to force duration to be known
    await this.seekTo(Math.max(0, this.video.duration - 0.1));

    const dur = this.video.duration * 1_000_000;
    // We don't know FPS yet — estimate from a 1-second sample
    const estimatedFps = await this.estimateFps();

    return {
      width:      this.video.videoWidth,
      height:     this.video.videoHeight,
      duration:   dur,
      fps:        estimatedFps,
      frameCount: Math.round((this.video.duration) * estimatedFps),
    };
  }

  /** Seek to a timestamp (seconds) and capture the frame */
  async captureAt(timeSeconds: number): Promise<DecodedFrame> {
    await this.seekTo(timeSeconds);
    return this.captureCurrentFrame();
  }

  /** Capture whatever frame is currently displayed */
  async captureCurrentFrame(): Promise<DecodedFrame> {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    const canvas = new OffscreenCanvas(w, h);
    // Note: alpha is NOT preserved via HTMLVideoElement — compositor composites to black
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(this.video, 0, 0, w, h);
    const bitmap = await createImageBitmap(canvas);

    return {
      index:       this.frameIdx,
      timestamp:   this.video.currentTime * 1_000_000,
      imageBitmap: bitmap,
      width:       w,
      height:      h,
    };
  }

  /** Use requestVideoFrameCallback to step one frame forward during playback */
  stepForward(): Promise<DecodedFrame> {
    return new Promise((resolve, reject) => {
      const rVFC = (this.video as any).requestVideoFrameCallback;
      if (!rVFC) {
        reject(new Error('requestVideoFrameCallback not supported'));
        return;
      }
      rVFC.call(this.video, (_now: number, _meta: any) => {
        this.captureCurrentFrame().then((frame) => {
          frame = { ...frame, index: this.frameIdx++ };
          this.onFrame(frame);
          resolve(frame);
        }).catch(reject);
      });
      this.video.play().catch(() => {/* may already be playing */});
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

  private seekTo(time: number): Promise<void> {
    return new Promise((resolve) => {
      if (Math.abs(this.video.currentTime - time) < 0.001) { resolve(); return; }
      this.video.onseeked = () => { this.video.onseeked = null; resolve(); };
      this.video.currentTime = time;
    });
  }

  private async estimateFps(): Promise<number> {
    // Count frames via rVFC over 0.5 s of playback
    if (typeof (this.video as any).requestVideoFrameCallback !== 'function') {
      return 30; // safe default
    }

    await this.seekTo(0);
    let count = 0;
    const startTime = this.video.currentTime;
    const SAMPLE_DURATION = 0.5; // seconds

    return new Promise((resolve) => {
      const tick = (_now: number, _meta: any) => {
        count++;
        if (this.video.currentTime - startTime < SAMPLE_DURATION) {
          (this.video as any).requestVideoFrameCallback(tick);
        } else {
          this.video.pause();
          const elapsed = this.video.currentTime - startTime;
          const fps = elapsed > 0 ? count / elapsed : 30;
          // Round to common frame rates
          const common = [24, 25, 30, 48, 50, 60, 120];
          const nearest = common.reduce((a, b) =>
            Math.abs(b - fps) < Math.abs(a - fps) ? b : a
          );
          resolve(Math.abs(nearest - fps) < 5 ? nearest : Math.round(fps));
        }
      };
      (this.video as any).requestVideoFrameCallback(tick);
      this.video.play().catch(() => resolve(30));
    });
  }
}

/**
 * Build VideoMetadata for a WebM file after load.
 * Called from App.ts after WebMDecoder.load() resolves.
 */
export function buildWebMMetadata(info: WebMInfo, file: File): Omit<VideoMetadata, 'decodePath'> {
  return {
    width:        info.width,
    height:       info.height,
    frameCount:   info.frameCount,
    duration:     info.duration,
    fps:          info.fps,
    codec:        'VP9/WebM',
    hasAlpha:     false, // <video> path loses alpha
    rotation:     0,     // WebM doesn't carry rotation metadata reliably via <video>
    isHDR:        false,
    originalName: file.name,
  };
}
