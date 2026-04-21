/**
 * mp4Demuxer.ts
 * Wraps mp4box.js to demux MP4 and MOV (QuickTime) containers.
 * WebM is NOT handled here — see webmDecoder.ts.
 *
 * Produces a stream of EncodedVideoChunk + frame metadata for WebCodecsDecoder.
 */

export interface TrackInfo {
  codec: string;           // e.g. "avc1.42E01E", "hvc1.1.6.L120.90", "vp09.00.10.08"
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  hasAlpha: boolean;
  isHDR: boolean;
  frameCount: number;
  duration: number;        // microseconds
  timescale: number;
  fps: number;
  codecConfig: Uint8Array | undefined;  // avcC / hvcC / vpcC raw bytes
}

export interface DemuxedChunk {
  chunk: EncodedVideoChunk;
  frameIndex: number;
  isKeyframe: boolean;
}

export type OnChunkCallback = (item: DemuxedChunk) => void;
export type OnReadyCallback = (info: TrackInfo) => void;
export type OnErrorCallback = (err: Error) => void;
export type OnFlushCallback = () => void;

export class MP4Demuxer {
  private mp4boxFile: any = null;
  private videoTrackId = -1;
  private frameIndex = 0;
  private readonly onChunk: OnChunkCallback;
  private readonly onReady: OnReadyCallback;
  private readonly onError: OnErrorCallback;
  private readonly onFlush: OnFlushCallback;

  constructor(opts: {
    onChunk: OnChunkCallback;
    onReady: OnReadyCallback;
    onError: OnErrorCallback;
    onFlush: OnFlushCallback;
  }) {
    this.onChunk = opts.onChunk;
    this.onReady = opts.onReady;
    this.onError = opts.onError;
    this.onFlush = opts.onFlush;
  }

  async init(): Promise<void> {
    const mp4boxMod = await import('mp4box');
    const MP4Box = (mp4boxMod as any).default ?? mp4boxMod;
    this.mp4boxFile = MP4Box.createFile();

    this.mp4boxFile.onReady = (info: any) => {
      // Pick the first real video track
      const vt = info.tracks.find((t: any) => t.type === 'video' || t.video);
      if (!vt) {
        this.onError(new Error('No video track found'));
        return;
      }
      this.videoTrackId = vt.id;
      this.onReady(this.buildTrackInfo(vt));
      this.mp4boxFile.setExtractionOptions(this.videoTrackId, null, { nbSamples: 100 });
      this.mp4boxFile.start();
    };

    this.mp4boxFile.onSamples = (_id: number, _ref: any, samples: any[]) => {
      for (const s of samples) {
        const chunk = new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          // mp4box gives composition time in track timescale units
          timestamp: (s.cts / s.timescale) * 1_000_000,
          duration:  (s.duration / s.timescale) * 1_000_000,
          data: s.data,
        });
        this.onChunk({ chunk, frameIndex: this.frameIndex++, isKeyframe: s.is_sync });
      }
    };

    this.mp4boxFile.onFlush = () => this.onFlush();
    this.mp4boxFile.onError  = (e: any) => this.onError(new Error(String(e)));
  }

  appendBuffer(buffer: ArrayBuffer, fileStart: number): void {
    (buffer as any).fileStart = fileStart;
    this.mp4boxFile.appendBuffer(buffer);
  }

  flush(): void {
    this.mp4boxFile.flush();
  }

  // ─── private helpers ───────────────────────────────────────────────

  private buildTrackInfo(vt: any): TrackInfo {
    const codec   = this.normalizeCodec(vt);
    const width   = vt.video?.width  ?? vt.track_width  ?? 0;
    const height  = vt.video?.height ?? vt.track_height ?? 0;
    const dur     = (vt.duration / vt.timescale) * 1_000_000;
    const count   = vt.nb_samples ?? 0;

    return {
      codec,
      width,
      height,
      rotation:    this.extractRotation(vt),
      hasAlpha:    this.detectAlpha(codec, vt),
      isHDR:       this.detectHDR(vt),
      frameCount:  count,
      duration:    dur,
      timescale:   vt.timescale,
      fps:         count > 0 && dur > 0 ? count / (dur / 1_000_000) : 0,
      codecConfig: this.extractCodecConfig(vt),
    };
  }

  /**
   * mp4box gives codec strings like "avc1" (no profile). For VideoDecoder
   * we need the full parameterised string. mp4box also provides it on
   * vt.codec which already includes the profile/level suffix in v0.5+.
   */
  private normalizeCodec(vt: any): string {
    const raw: string = vt.codec ?? '';
    // Already fully qualified (e.g. "avc1.64001f", "hvc1.1.6.L150.B0", "vp09.00.10.08")
    if (raw.includes('.')) return raw;
    // Bare codec box type — WebCodecs still accepts these for common cases
    return raw || 'avc1';
  }

  private extractCodecConfig(vt: any): Uint8Array | undefined {
    // mp4box exposes the raw codec config box as vt.extradata (Uint8Array)
    const ed = vt.extradata;
    if (!ed) return undefined;
    if (ed instanceof Uint8Array) return ed;
    // Some builds return an ArrayBuffer
    if (ed instanceof ArrayBuffer) return new Uint8Array(ed);
    return undefined;
  }

  private extractRotation(vt: any): 0 | 90 | 180 | 270 {
    // Track matrix: flat [a, b, u, c, d, v, tx, ty, w] in fixed-point 16.16
    const m = vt.matrix;
    if (!m || m.length < 9) return 0;
    // Fixed-point: 65536 = 1.0
    const a = m[0] / 65536;
    const b = m[1] / 65536;
    if (Math.abs(b - 1)  < 0.1 && Math.abs(a) < 0.1) return 90;
    if (Math.abs(b + 1)  < 0.1 && Math.abs(a) < 0.1) return 270;
    if (Math.abs(a + 1)  < 0.1 && Math.abs(b) < 0.1) return 180;
    return 0;
  }

  private detectAlpha(codec: string, vt: any): boolean {
    // HEVC with alpha uses profile 2 (Main Still Picture / Main 4:2:2 10)
    if (codec.startsWith('hvc1.2') || codec.startsWith('hev1.2')) return true;
    // VP9 profile 3 carries alpha in a separate stream
    if (codec.startsWith('vp09.03')) return true;
    // Auxiliary video track named "alpha" associated with this track
    if (vt.alternate_group && vt.name?.toLowerCase().includes('alpha')) return true;
    return false;
  }

  private detectHDR(vt: any): boolean {
    const c = vt.color ?? vt.colr ?? vt.colour;
    if (!c) return false;
    return c.primaries === 9 || c.transfer === 16 || c.transfer === 18;
  }
}

// ─── Convenience wrapper ────────────────────────────────────────────────

/** Stream-demux an entire File, resolving with TrackInfo when the header is parsed. */
export async function demuxFile(
  file: File,
  onChunk: OnChunkCallback,
  onFlush: OnFlushCallback,
): Promise<TrackInfo> {
  return new Promise((resolve, reject) => {
    const demuxer = new MP4Demuxer({ onReady: resolve, onChunk, onError: reject, onFlush });

    (async () => {
      await demuxer.init();
      const CHUNK = 4 * 1024 * 1024; // 4 MB slices
      let offset = 0;
      while (offset < file.size) {
        const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
        demuxer.appendBuffer(buf, offset);
        offset += buf.byteLength;
      }
      demuxer.flush();
    })().catch(reject);
  });
}
