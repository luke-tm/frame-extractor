/**
 * detect.ts — runtime capability detection and decode-path selection.
 *
 * Decode path matrix:
 *
 *   Format   | WebCodecs available  | Fallback
 *   ---------|---------------------|------------------------------------
 *   MP4      | webcodecs           | video-element
 *   MOV      | webcodecs           | video-element
 *   WebM     | webm-video-element  | webm-video-element (always; no mp4box)
 *   GIF      | gif-imagedecoder    | gif-gifuct
 *
 * Note: WebM uses the video-element path regardless of WebCodecs availability
 * because we don't ship a Matroska demuxer. Alpha is lost on WebM. This is
 * documented clearly in the UI.
 */

import type { DecodePathType } from '../types';

export interface Capabilities {
  hasVideoDecoder: boolean;
  hasImageDecoder: boolean;
  hasRequestVideoFrameCallback: boolean;
  hasOffscreenCanvas: boolean;
  hasWebShareFiles: boolean;
  canPlayWebM: boolean;
}

let _caps: Capabilities | null = null;

export function getCapabilities(): Capabilities {
  if (_caps) return _caps;
  const testVideo = document.createElement('video');
  _caps = {
    hasVideoDecoder:   typeof VideoDecoder !== 'undefined',
    hasImageDecoder:   typeof ImageDecoder !== 'undefined',
    hasRequestVideoFrameCallback:
      typeof (testVideo as any).requestVideoFrameCallback === 'function',
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    hasWebShareFiles:
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function',
    canPlayWebM: (() => {
      const s = testVideo.canPlayType('video/webm; codecs="vp9"');
      return s === 'probably' || s === 'maybe';
    })(),
  };
  return _caps;
}

/** Select the decode path for a given MIME type string. */
export function selectDecodePath(mimeType: string): DecodePathType {
  const caps = getCapabilities();

  if (mimeType === 'image/gif') {
    return caps.hasImageDecoder ? 'gif-imagedecoder' : 'gif-gifuct';
  }

  if (mimeType === 'video/webm') {
    // Always use the video-element path for WebM (no Matroska demuxer)
    return 'video-element';
  }

  // MP4 / MOV / QuickTime
  return caps.hasVideoDecoder ? 'webcodecs' : 'video-element';
}

/** Returns true if this decode path cannot preserve alpha. */
export function pathLosesAlpha(path: DecodePathType): boolean {
  return path === 'video-element';
}

/** Returns a human-readable explanation of why alpha is lost on this path. */
export function alphaLossReason(mimeType: string): string {
  if (mimeType === 'video/webm') {
    return 'WebM uses the browser video element for decoding — ' +
      'VP9 alpha tracks in Matroska containers require a full WebM demuxer. ' +
      'Alpha channel will not be preserved in exports.';
  }
  return 'WebCodecs is not available on this browser (iOS Safari 17.3 or earlier). ' +
    'Alpha channel will not be preserved in exports.';
}

/** Async codec support probe — used before configuring VideoDecoder. */
export async function probeCodecSupport(
  codec: string,
  width: number,
  height: number,
  extradata?: AllowSharedBufferSource,
): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    const config: VideoDecoderConfig = { codec, codedWidth: width, codedHeight: height };
    if (extradata) config.description = extradata;
    const result = await VideoDecoder.isConfigSupported(config);
    return result.supported ?? false;
  } catch {
    return false;
  }
}

/** iOS version number, or null on non-iOS. */
export function getIOSVersion(): number | null {
  const m = navigator.userAgent.match(/OS (\d+)_/);
  return m ? parseInt(m[1], 10) : null;
}
