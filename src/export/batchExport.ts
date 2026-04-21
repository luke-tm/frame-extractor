/**
 * batchExport.ts — export a range of frames as a ZIP
 */

import JSZip from 'jszip';
import type { BatchExportOptions, DecodedFrame, VideoMetadata } from '../types';
import { buildFilename } from './singleFrame';

export type ProgressCallback = (done: number, total: number) => void;

export async function batchExportFrames(
  getFrame: (index: number) => ImageBitmap | undefined,
  meta: VideoMetadata,
  getTimestamp: (index: number) => number,
  opts: BatchExportOptions,
  onProgress?: ProgressCallback
): Promise<void> {
  const zip = new JSZip();
  const total = opts.endFrame - opts.startFrame + 1;

  const mimeType =
    opts.format === 'jpeg' ? 'image/jpeg' :
    opts.format === 'webp' ? 'image/webp' : 'image/png';

  const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;

  for (let i = opts.startFrame; i <= opts.endFrame; i++) {
    const bitmap = getFrame(i);
    if (!bitmap) continue;

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: opts.format !== 'jpeg' })!;

    if (opts.format === 'jpeg') {
      ctx.fillStyle = opts.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
        mimeType,
        opts.format === 'png' ? undefined : opts.quality
      );
    });

    const ts = getTimestamp(i);
    const filename = buildFilename(meta, i, ts, ext);
    zip.file(filename, blob);

    onProgress?.(i - opts.startFrame + 1, total);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const baseName = meta.originalName.replace(/\.[^.]+$/, '');
  const zipName = `${baseName}_frames_${opts.startFrame}-${opts.endFrame}.zip`;

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
