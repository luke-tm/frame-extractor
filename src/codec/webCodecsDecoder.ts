/**
 * webCodecsDecoder.ts
 * 
 * Drives VideoDecoder with chunks from mp4Demuxer.
 * Implements a sliding-window strategy: decode ±30 frames around playhead.
 * 
 * Alpha is preserved end-to-end:
 *   VideoFrame → drawImage onto OffscreenCanvas (2D) → ImageBitmap
 *   The canvas context preserves alpha by default (premultipliedAlpha: false).
 */

import type { DecodedFrame } from '../types';
import type { TrackInfo, DemuxedChunk } from './mp4Demuxer';

export type OnFrameDecodedCallback = (frame: DecodedFrame) => void;
export type OnDecodeErrorCallback = (frameIndex: number, err: Error) => void;

const WINDOW_HALF = 30;

export class WebCodecsDecoder {
  private decoder!: VideoDecoder;
  private trackInfo: TrackInfo;
  private onFrameDecoded: OnFrameDecodedCallback;
  private onError: OnDecodeErrorCallback;

  // Frame cache: index → ImageBitmap
  private cache = new Map<number, ImageBitmap>();
  // Thumbnail cache: index → ImageBitmap (low-res)
  private thumbCache = new Map<number, ImageBitmap>();
  // Pending frame decode tracking
  private pendingDecodeIndex = 0;
  // All buffered chunks from demuxer
  private allChunks: DemuxedChunk[] = [];
  private decodeActive = false;

  constructor(opts: {
    trackInfo: TrackInfo;
    onFrameDecoded: OnFrameDecodedCallback;
    onError: OnDecodeErrorCallback;
  }) {
    this.trackInfo = opts.trackInfo;
    this.onFrameDecoded = opts.onFrameDecoded;
    this.onError = opts.onError;
  }

  async init(): Promise<void> {
    const { codec, codecConfig, width, height } = this.trackInfo;

    const config: VideoDecoderConfig = {
      codec,
      codedWidth: width,
      codedHeight: height,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: false,
    };

    // Attach extradata (avcC/hvcC) if available
    if (codecConfig) {
      config.description = codecConfig;
    }

    // Check support
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      throw new Error(`VideoDecoder: codec not supported: ${codec}`);
    }

    this.decoder = new VideoDecoder({
      output: (frame) => this.handleFrame(frame),
      error: (err) => {
        console.error('[WebCodecsDecoder] decoder error', err);
        this.onError(this.pendingDecodeIndex, err instanceof Error ? err : new Error(String(err)));
      },
    });

    this.decoder.configure(config);
  }

  /** Receive all chunks from demuxer upfront (suitable for files < ~200MB) */
  storeChunks(chunks: DemuxedChunk[]): void {
    this.allChunks = chunks;
  }

  /** Decode the sliding window around `centerIndex` */
  async seekAndDecode(centerIndex: number, frameIndex: FrameIndexRef): Promise<void> {
    if (this.decodeActive) {
      // Flush current decode before starting new seek
      try { this.decoder.reset(); } catch { /* ignore */ }
      this.decoder.configure({
        codec: this.trackInfo.codec,
        codedWidth: this.trackInfo.width,
        codedHeight: this.trackInfo.height,
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: false,
        description: this.trackInfo.codecConfig,
      });
    }

    const start = Math.max(0, centerIndex - WINDOW_HALF);
    const end = Math.min(this.allChunks.length - 1, centerIndex + WINDOW_HALF);

    // Find the nearest keyframe before start
    const keyframeIdx = frameIndex.nearestKeyframeBefore(start);
    const decodeStart = keyframeIdx;

    this.decodeActive = true;
    this.pendingDecodeIndex = decodeStart;

    const windowChunks = this.allChunks.slice(decodeStart, end + 1);

    for (const { chunk, frameIndex: fi } of windowChunks) {
      this.pendingDecodeIndex = fi;
      try {
        this.decoder.decode(chunk);
      } catch (err) {
        this.onError(fi, err instanceof Error ? err : new Error(String(err)));
      }
    }

    await this.decoder.flush();
    this.decodeActive = false;
  }

  /** Decode a single chunk (used in streaming mode) */
  decodeChunk(item: DemuxedChunk): void {
    this.pendingDecodeIndex = item.frameIndex;
    try {
      this.decoder.decode(item.chunk);
    } catch (err) {
      this.onError(item.frameIndex, err instanceof Error ? err : new Error(String(err)));
    }
  }

  async flush(): Promise<void> {
    await this.decoder.flush();
  }

  getFrameFromCache(index: number): ImageBitmap | undefined {
    return this.cache.get(index);
  }

  getThumbnail(index: number): ImageBitmap | undefined {
    return this.thumbCache.get(index);
  }

  /** Free all cached frames outside the current window */
  pruneCache(centerIndex: number): void {
    const keepStart = centerIndex - WINDOW_HALF * 2;
    const keepEnd = centerIndex + WINDOW_HALF * 2;

    for (const [idx, bmp] of this.cache.entries()) {
      if (idx < keepStart || idx > keepEnd) {
        bmp.close();
        this.cache.delete(idx);
      }
    }
  }

  dispose(): void {
    for (const bmp of this.cache.values()) bmp.close();
    for (const bmp of this.thumbCache.values()) bmp.close();
    this.cache.clear();
    this.thumbCache.clear();
    try { this.decoder.close(); } catch { /* ignore */ }
  }

  private async handleFrame(frame: VideoFrame): Promise<void> {
    const fi = this.pendingDecodeIndex;

    try {
      // Draw to OffscreenCanvas preserving alpha
      const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
      const ctx = canvas.getContext('2d', {
        alpha: true,
        willReadFrequently: false,
      })!;

      ctx.drawImage(frame, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      this.cache.set(fi, bitmap);

      // Generate low-res thumbnail (1/8 scale, min 16px)
      const thumbW = Math.max(16, Math.floor(frame.displayWidth / 8));
      const thumbH = Math.max(16, Math.floor(frame.displayHeight / 8));
      const thumbCanvas = new OffscreenCanvas(thumbW, thumbH);
      const thumbCtx = thumbCanvas.getContext('2d', { alpha: true })!;
      thumbCtx.drawImage(frame, 0, 0, thumbW, thumbH);
      const thumbBitmap = await createImageBitmap(thumbCanvas);
      this.thumbCache.set(fi, thumbBitmap);

      this.onFrameDecoded({
        index: fi,
        timestamp: frame.timestamp,
        imageBitmap: bitmap,
        width: frame.displayWidth,
        height: frame.displayHeight,
      });
    } finally {
      frame.close();
    }
  }
}

// Lightweight interface so webCodecsDecoder doesn't import the full FrameIndex
interface FrameIndexRef {
  nearestKeyframeBefore(index: number): number;
}
