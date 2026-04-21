/**
 * gifDecoder.ts
 *
 * Two-path GIF decoding with full alpha preservation:
 *
 *   Path A — ImageDecoder (WebCodecs family)
 *     Available: Chrome 94+, iOS Safari 17.4+
 *     Alpha: ✓ preserved natively
 *     Timing: ✓ per-frame timestamps from the codec
 *
 *   Path B — gifuct-js
 *     Fallback for all other browsers
 *     Alpha: ✓ preserved (gifuct decompresses RGBA pixel data)
 *     Timing: derived from GCE delay field (centiseconds × 10ms)
 *
 * Both paths composite partial frames correctly using the GIF disposal model.
 */

import { parseGIF, decompressFrames } from 'gifuct-js';
import type { DecodedFrame } from '../types';

export interface GifInfo {
  frameCount: number;
  width: number;
  height: number;
  duration: number;  // microseconds
  fps: number;
}

// ─── Path A: ImageDecoder ─────────────────────────────────────────────────────

export async function decodeGifWithImageDecoder(
  file: File,
  onFrame: (frame: DecodedFrame) => void,
): Promise<GifInfo> {
  if (typeof ImageDecoder === 'undefined') {
    throw new Error('ImageDecoder not available');
  }

  const arrayBuffer = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: arrayBuffer as unknown as ImageBufferSource, type: 'image/gif' });

  await decoder.tracks.ready;
  // Wait for all frame metadata to be indexed (non-streaming GIFs)
  try { await decoder.completed; } catch { /* progressive decode — continue anyway */ }

  const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
  if (frameCount === 0) throw new Error('ImageDecoder: no frames found in GIF');

  let totalDuration = 0;
  let width = 0;
  let height = 0;

  for (let i = 0; i < frameCount; i++) {
    let result: ImageDecodeResult;
    try {
      result = await decoder.decode({ frameIndex: i });
    } catch (err) {
      console.warn(`[GIF ImageDecoder] frame ${i} failed:`, err);
      continue;
    }

    const vf = result.image;

    if (i === 0) {
      width  = vf.displayWidth;
      height = vf.displayHeight;
    }

    // Render to OffscreenCanvas preserving alpha
    const oc  = new OffscreenCanvas(vf.displayWidth, vf.displayHeight);
    const ctx = oc.getContext('2d', { alpha: true })!;
    ctx.drawImage(vf, 0, 0);

    const bitmap  = await createImageBitmap(oc);
    const ts      = vf.timestamp;                    // microseconds
    const dur     = vf.duration ?? 100_000;          // default 100ms if absent
    totalDuration += dur;

    onFrame({ index: i, timestamp: ts, imageBitmap: bitmap, width: vf.displayWidth, height: vf.displayHeight });
    vf.close();
  }

  decoder.close();

  return {
    frameCount,
    width,
    height,
    duration: totalDuration,
    fps: totalDuration > 0 ? frameCount / (totalDuration / 1_000_000) : 10,
  };
}

// ─── Path B: gifuct-js ────────────────────────────────────────────────────────

export async function decodeGifWithGifuct(
  file: File,
  onFrame: (frame: DecodedFrame) => void,
): Promise<GifInfo> {
  const buffer = await file.arrayBuffer();
  const gif    = parseGIF(buffer);
  const frames = decompressFrames(gif, true);   // true = build RGBA patches

  const width  = gif.lsd.width;
  const height = gif.lsd.height;

  // Persistent composite canvas — required for correct GIF disposal mode handling
  const composite    = new OffscreenCanvas(width, height);
  const compositeCtx = composite.getContext('2d', { alpha: true })!;

  // Previous frame state for disposal mode 3 (restore-to-previous)
  let savedImageData: ImageData | null = null;

  let timestamp = 0;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];

    // ── Apply disposal from PREVIOUS frame ──────────────────────────────────
    if (i > 0) {
      const prevDisposal = frames[i - 1].disposalType;
      if (prevDisposal === 2) {
        // Restore to background (transparent)
        compositeCtx.clearRect(
          frames[i - 1].dims.left,
          frames[i - 1].dims.top,
          frames[i - 1].dims.width,
          frames[i - 1].dims.height,
        );
      } else if (prevDisposal === 3 && savedImageData) {
        // Restore to previous state
        compositeCtx.putImageData(savedImageData, 0, 0);
      }
      // Disposal 0/1: leave in place — do nothing
    }

    // ── Save state before drawing (for disposal mode 3) ────────────────────
    if (f.disposalType === 3) {
      savedImageData = compositeCtx.getImageData(0, 0, width, height);
    }

    // ── Draw this frame's patch onto the composite ──────────────────────────
    // f.patch is Uint8ClampedArray of RGBA pixel data for the patch rectangle
    const patchImageData = new ImageData(
      new Uint8ClampedArray(f.patch),   // copy to ensure plain ArrayBuffer
      f.dims.width,
      f.dims.height,
    );

    const patchOC  = new OffscreenCanvas(f.dims.width, f.dims.height);
    const patchCtx = patchOC.getContext('2d', { alpha: true })!;
    patchCtx.putImageData(patchImageData, 0, 0);

    const patchBitmap = await createImageBitmap(patchOC);
    compositeCtx.drawImage(patchBitmap, f.dims.left, f.dims.top);
    patchBitmap.close();

    // ── Snapshot the composite as this frame's ImageBitmap ─────────────────
    const frameBitmap = await createImageBitmap(composite);

    // GCE delay is in centiseconds; 0 means "as fast as possible" → treat as 10ms
    const delayMs  = (f.delay > 0 ? f.delay : 1) * 10;
    const duration = delayMs * 1_000;  // microseconds

    onFrame({
      index:       i,
      timestamp,
      imageBitmap: frameBitmap,
      width,
      height,
    });

    timestamp += duration;
  }

  const totalDuration = timestamp;
  return {
    frameCount: frames.length,
    width,
    height,
    duration: totalDuration,
    fps: totalDuration > 0 ? frames.length / (totalDuration / 1_000_000) : 10,
  };
}
