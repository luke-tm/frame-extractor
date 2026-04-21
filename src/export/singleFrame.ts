/**
 * singleFrame.ts — export a single decoded frame
 */

import type { ExportOptions, VideoMetadata } from '../types';

export function buildFilename(
  meta: VideoMetadata,
  frameIndex: number,
  timestamp: number,
  ext: string
): string {
  const baseName = meta.originalName.replace(/\.[^.]+$/, '');
  const ts = formatTimestampForFilename(timestamp);
  return `${baseName}_frame${String(frameIndex).padStart(6, '0')}_${ts}.${ext}`;
}

function formatTimestampForFilename(us: number): string {
  const totalMs = Math.floor(us / 1000);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000);
  return `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s${String(ms).padStart(3, '0')}`;
}

/**
 * Export a single frame bitmap to a downloadable file.
 * Also offers Web Share API on supported devices.
 */
export async function exportFrame(
  bitmap: ImageBitmap,
  meta: VideoMetadata,
  frameIndex: number,
  timestamp: number,
  opts: ExportOptions
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { alpha: opts.format !== 'jpeg' })!;

  if (opts.format === 'jpeg') {
    // Flatten alpha against background color
    ctx.fillStyle = opts.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(bitmap, 0, 0);

  const mimeType =
    opts.format === 'jpeg' ? 'image/jpeg' :
    opts.format === 'webp' ? 'image/webp' : 'image/png';

  const quality = opts.format === 'png' ? undefined : opts.quality;
  const filename = buildFilename(meta, frameIndex, timestamp, opts.format === 'jpeg' ? 'jpg' : opts.format);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
      mimeType,
      quality
    );
  });

  // Try Web Share first (iOS saves directly to Photos)
  if (navigator.canShare?.({ files: [new File([blob], filename, { type: mimeType })] })) {
    try {
      await navigator.share({
        files: [new File([blob], filename, { type: mimeType })],
        title: filename,
      });
      return;
    } catch (err: any) {
      // User cancelled or share failed — fall through to download
      if (err.name !== 'AbortError') console.warn('Share failed, falling back to download', err);
    }
  }

  // Standard download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
