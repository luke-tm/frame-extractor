/**
 * App.ts — top-level orchestrator
 *
 * Format routing:
 *   MP4 / MOV   → WebCodecs (mp4box demux) or <video> fallback
 *   WebM        → <video> + rVFC (alpha lost, banner shown)
 *   GIF         → ImageDecoder or gifuct-js (both preserve alpha)
 */

import { selectDecodePath, pathLosesAlpha, alphaLossReason, getCapabilities, probeCodecSupport } from '../codec/detect';
import { demuxFile } from '../codec/mp4Demuxer';
import { WebCodecsDecoder } from '../codec/webCodecsDecoder';
import { VideoElementDecoder } from '../codec/videoElDecoder';
import { WebMDecoder, buildWebMMetadata } from '../codec/webmDecoder';
import { decodeGifWithImageDecoder, decodeGifWithGifuct } from '../codec/gifDecoder';
import { FrameIndex } from '../codec/frameIndex';
import { Preview } from './Preview';
import { Scrubber } from './Scrubber';
import { Controls } from './Controls';
import { ExportPanel } from './ExportPanel';
import { WarningBanner } from './WarningBanner';
import { exportFrame } from '../export/singleFrame';
import { batchExportFrames } from '../export/batchExport';
import type { VideoMetadata, DecodedFrame, DecodePathType } from '../types';
import type { DemuxedChunk } from '../codec/mp4Demuxer';

export class App {
  private root: HTMLElement;

  // UI components
  private preview!: Preview;
  private scrubber!: Scrubber;
  private controls!: Controls;
  private exportPanel!: ExportPanel;
  private banners!: WarningBanner;
  private fileInput!: HTMLInputElement;
  private dropZone!: HTMLElement;
  private loadingEl!: HTMLElement;
  private loadingText!: HTMLElement;

  // State
  private metadata: VideoMetadata | null = null;
  private frameIndex = new FrameIndex();
  private currentFrameIdx = 0;
  private decodePath: DecodePathType = 'webcodecs';
  private currentMime = '';

  // Decoders
  private webCodecsDecoder: WebCodecsDecoder | null = null;
  private videoElDecoder: VideoElementDecoder | null = null;
  private webmDecoder: WebMDecoder | null = null;
  private gifFrames: DecodedFrame[] = [];
  private allChunks: DemuxedChunk[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    this.root.innerHTML = `
      <header class="app-header">
        <div class="app-header__logo">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="10" cy="10" r="3" fill="currentColor"/>
            <path d="M2 7h2M16 7h2M2 13h2M16 13h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>FrameExtract</span>
        </div>
        <div class="app-header__meta" id="decode-path-badge"></div>
      </header>

      <div class="app-body">
        <div class="app-left">
          <div class="drop-zone" id="drop-zone" role="button" tabindex="0" aria-label="Drop video here or click to select">
            <div class="drop-zone__inner">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <path d="M16 4v16M8 12l8-8 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 24h24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <p class="drop-zone__label">Drop video here</p>
              <p class="drop-zone__sub">MP4 · MOV · WebM · GIF — or click to browse</p>
              <input
                type="file"
                id="file-input"
                accept="video/*,image/gif"
                class="drop-zone__input"
                aria-label="Select video file"
              >
            </div>
          </div>

          <div class="banners" id="banners"></div>

          <div class="preview-wrapper" id="preview-wrapper">
            <div class="loading" id="loading" style="display:none" aria-live="polite" aria-busy="true">
              <div class="loading__spinner"></div>
              <span class="loading__text" id="loading-text">Loading…</span>
            </div>
          </div>
        </div>

        <div class="app-right">
          <div class="scrubber-wrapper" id="scrubber-wrapper"></div>
          <div class="controls-wrapper" id="controls-wrapper"></div>
          <div class="export-wrapper" id="export-wrapper"></div>
        </div>
      </div>
    `;

    this.fileInput   = this.root.querySelector('#file-input')!;
    this.dropZone    = this.root.querySelector('#drop-zone')!;
    this.loadingEl   = this.root.querySelector('#loading')!;
    this.loadingText = this.root.querySelector('#loading-text')!;

    this.banners = new WarningBanner(this.root.querySelector('#banners')!);

    this.preview = new Preview(
      this.root.querySelector('#preview-wrapper')!,
      (delta) => this.stepFrame(delta),
    );

    this.scrubber = new Scrubber(
      this.root.querySelector('#scrubber-wrapper')!,
      (idx) => this.seekToFrame(idx),
    );

    this.controls = new Controls(
      this.root.querySelector('#controls-wrapper')!,
      (delta) => this.stepFrame(delta),
      (start, end) => this.exportPanel.setBatchRange(start, end),
    );

    this.exportPanel = new ExportPanel(
      this.root.querySelector('#export-wrapper')!,
      (opts) => {
        if (!this.metadata) return;
        const bitmap = this.getCachedBitmap(this.currentFrameIdx);
        if (!bitmap) return;
        const ts = this.frameIndex.getTimestamp(this.currentFrameIdx) ?? 0;
        exportFrame(bitmap, this.metadata, this.currentFrameIdx, ts, opts);
      },
      async (opts) => {
        if (!this.metadata) return;
        await batchExportFrames(
          (i) => this.getCachedBitmap(i),
          this.metadata,
          (i) => this.frameIndex.getTimestamp(i) ?? 0,
          opts,
          (done, total) => this.exportPanel.showProgress(done, total),
        );
      },
    );

    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      if (f) this.loadFile(f);
    });

    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this.fileInput.click();
    });
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drop-zone--over');
    });
    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drop-zone--over');
    });
    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drop-zone--over');
      const f = e.dataTransfer?.files[0];
      if (f) this.loadFile(f);
    });

    this.showDecodeBadge();
  }

  // ─── Decode badge ───────────────────────────────────────────────────

  private showDecodeBadge(): void {
    const caps  = getCapabilities();
    const badge = this.root.querySelector('#decode-path-badge')!;
    badge.textContent = caps.hasVideoDecoder ? 'WebCodecs' : 'Legacy';
    badge.className = `decode-badge ${caps.hasVideoDecoder ? 'decode-badge--modern' : 'decode-badge--legacy'}`;
  }

  // ─── File loading ───────────────────────────────────────────────────

  private async loadFile(file: File): Promise<void> {
    this.banners.dismissAll();
    this.disposeDecoders();
    this.frameIndex     = new FrameIndex();
    this.gifFrames      = [];
    this.allChunks      = [];
    this.currentFrameIdx = 0;

    this.currentMime = file.type || this.inferMime(file.name);
    this.decodePath  = selectDecodePath(this.currentMime);

    if (pathLosesAlpha(this.decodePath)) {
      this.banners.show('alpha-lost', alphaLossReason(this.currentMime));
    }

    this.setLoading(true, 'Loading…');

    try {
      if (this.currentMime === 'image/gif') {
        await this.loadGif(file);
      } else if (this.currentMime === 'video/webm') {
        await this.loadWebM(file);
      } else {
        // MP4 / MOV / other ISOBMFF
        await this.loadISOBMFF(file);
      }
    } catch (err) {
      console.error('[App] load error', err);
      this.banners.show('error', `Failed to load: ${(err as Error).message}`);
      this.setLoading(false);
    }
  }

  // ─── MP4 / MOV loader ──────────────────────────────────────────────

  private async loadISOBMFF(file: File): Promise<void> {
    if (this.decodePath === 'webcodecs') {
      await this.loadISOBMFFWebCodecs(file);
    } else {
      await this.loadISOBMFFVideoElement(file);
    }
  }

  private async loadISOBMFFWebCodecs(file: File): Promise<void> {
    this.setLoading(true, 'Demuxing…');
    const chunks: DemuxedChunk[] = [];

    const trackInfo = await demuxFile(
      file,
      (item) => {
        chunks.push(item);
        this.frameIndex.addFrame({
          index:      item.frameIndex,
          timestamp:  item.chunk.timestamp,
          isKeyframe: item.isKeyframe,
          duration:   item.chunk.duration ?? 0,
        });
        if (item.frameIndex % 50 === 0) {
          this.setLoading(true, `Demuxing… ${item.frameIndex} frames`);
        }
      },
      () => { /* flush complete — decoding begins */ },
    );

    this.allChunks = chunks;

    // Probe codec support before committing to this path
    const supported = await probeCodecSupport(
      trackInfo.codec,
      trackInfo.width,
      trackInfo.height,
      trackInfo.codecConfig,
    );

    if (!supported) {
      console.warn(`[App] codec ${trackInfo.codec} not supported by VideoDecoder — falling back to <video>`);
      this.decodePath = 'video-element';
      this.banners.show('alpha-lost',
        `Codec ${trackInfo.codec} is not supported by WebCodecs on this device. ` +
        `Using video element fallback — alpha will not be preserved.`
      );
      await this.loadISOBMFFVideoElement(file);
      return;
    }

    const metadata: VideoMetadata = {
      width:        trackInfo.width,
      height:       trackInfo.height,
      frameCount:   trackInfo.frameCount,
      duration:     trackInfo.duration,
      fps:          trackInfo.fps,
      codec:        trackInfo.codec,
      hasAlpha:     trackInfo.hasAlpha,
      rotation:     trackInfo.rotation,
      isHDR:        trackInfo.isHDR,
      decodePath:   'webcodecs',
      originalName: file.name,
    };
    this.metadata = metadata;

    if (trackInfo.isHDR) {
      this.banners.show('hdr',
        'HDR video detected — colors may appear washed out on SDR displays. ' +
        'Exported frames will contain HDR metadata.'
      );
    }

    this.setLoading(true, 'Initializing decoder…');

    const decoder = new WebCodecsDecoder({
      trackInfo,
      onFrameDecoded: (frame) => {
        // Always update if this frame is in our window
        if (
          frame.index === this.currentFrameIdx ||
          this.webCodecsDecoder?.getFrameFromCache(this.currentFrameIdx) == null
        ) {
          this.renderFrame(frame);
        }
      },
      onError: (idx, err) => {
        console.error(`[WebCodecs] frame ${idx} error:`, err);
        // Don't spam banners for mid-stream errors — just log
      },
    });

    await decoder.init();
    decoder.storeChunks(chunks);
    this.webCodecsDecoder = decoder;

    this.enableUI(metadata);
    this.setLoading(true, 'Decoding first frame…');
    await this.seekToFrame(0);
  }

  private async loadISOBMFFVideoElement(file: File): Promise<void> {
    this.setLoading(true, 'Loading video…');

    const decoder = new VideoElementDecoder((frame) => {
      if (frame.index === this.currentFrameIdx) this.renderFrame(frame);
    });

    const info = await decoder.load(file);
    this.videoElDecoder = decoder;

    // <video> doesn't expose frame count — estimate
    const fps            = 30;
    const estimatedCount = Math.max(1, Math.round((info.duration / 1_000_000) * fps));

    for (let i = 0; i < estimatedCount; i++) {
      this.frameIndex.addFrame({
        index:      i,
        timestamp:  i * (1_000_000 / fps),
        isKeyframe: i % 30 === 0,
        duration:   1_000_000 / fps,
      });
    }

    const metadata: VideoMetadata = {
      width:        info.width,
      height:       info.height,
      frameCount:   estimatedCount,
      duration:     info.duration,
      fps,
      codec:        this.currentMime === 'video/quicktime' ? 'H.264/MOV' : 'H.264',
      hasAlpha:     false,
      rotation:     0,
      isHDR:        false,
      decodePath:   'video-element',
      originalName: file.name,
    };
    this.metadata = metadata;

    this.enableUI(metadata);
    const frame = await decoder.seekToTime(0);
    this.renderFrame(frame);
  }

  // ─── WebM loader ────────────────────────────────────────────────────

  private async loadWebM(file: File): Promise<void> {
    this.setLoading(true, 'Loading WebM…');

    if (!WebMDecoder.canPlay()) {
      this.banners.show('error',
        'This browser cannot play WebM files. ' +
        'On iOS Safari, WebM is not supported — convert to MP4/MOV first.'
      );
      this.setLoading(false);
      return;
    }

    const dec = new WebMDecoder((frame) => {
      if (frame.index === this.currentFrameIdx) this.renderFrame(frame);
    });

    this.setLoading(true, 'Probing WebM…');
    const info = await dec.load(file);
    this.webmDecoder = dec;

    // Build frame index from estimated fps
    for (let i = 0; i < info.frameCount; i++) {
      this.frameIndex.addFrame({
        index:      i,
        timestamp:  i * (1_000_000 / info.fps),
        isKeyframe: i % Math.round(info.fps) === 0,
        duration:   1_000_000 / info.fps,
      });
    }

    const metadata: VideoMetadata = {
      ...buildWebMMetadata(info, file),
      decodePath: 'video-element',
    };
    this.metadata = metadata;

    this.enableUI(metadata);

    this.setLoading(true, 'Capturing first frame…');
    const first = await dec.captureAt(0);
    first.index = 0;
    this.renderFrame(first);
  }

  // ─── GIF loader ─────────────────────────────────────────────────────

  private async loadGif(file: File): Promise<void> {
    const frames: DecodedFrame[] = [];
    const decode = this.decodePath === 'gif-imagedecoder'
      ? decodeGifWithImageDecoder
      : decodeGifWithGifuct;

    this.setLoading(true, 'Decoding GIF…');

    const info = await decode(file, (frame) => {
      frames.push(frame);
      this.frameIndex.addFrame({
        index:      frame.index,
        timestamp:  frame.timestamp,
        isKeyframe: true,
        duration:   0,
      });
      this.setLoading(true, `Decoding GIF… ${frames.length} frames`);
    });

    this.gifFrames = frames;

    const metadata: VideoMetadata = {
      width:        info.width,
      height:       info.height,
      frameCount:   info.frameCount,
      duration:     info.duration,
      fps:          info.fps,
      codec:        'GIF',
      hasAlpha:     true,
      rotation:     0,
      isHDR:        false,
      decodePath:   this.decodePath,
      originalName: file.name,
    };
    this.metadata = metadata;

    this.enableUI(metadata);
    if (frames.length > 0) this.renderFrame(frames[0]);
  }

  // ─── Seek / step ────────────────────────────────────────────────────

  private async seekToFrame(index: number): Promise<void> {
    if (!this.metadata) return;
    const clamped = Math.max(0, Math.min(this.metadata.frameCount - 1, index));
    this.currentFrameIdx = clamped;

    // GIF: all frames already decoded in memory
    if (this.decodePath === 'gif-imagedecoder' || this.decodePath === 'gif-gifuct') {
      const frame = this.gifFrames[clamped];
      if (frame) this.renderFrame(frame);
      return;
    }

    // WebM: seek video element to timestamp
    if (this.webmDecoder) {
      const ts = this.frameIndex.getTimestamp(clamped) ?? 0;
      const frame = await this.webmDecoder.captureAt(ts / 1_000_000);
      this.renderFrame({ ...frame, index: clamped });
      return;
    }

    // WebCodecs: check cache, then decode window
    if (this.webCodecsDecoder) {
      const cached = this.webCodecsDecoder.getFrameFromCache(clamped);
      if (cached) {
        const ts = this.frameIndex.getTimestamp(clamped) ?? 0;
        this.renderFrame({ index: clamped, timestamp: ts, imageBitmap: cached, width: cached.width, height: cached.height });
        // Kick off background prefetch for surrounding frames
        this.webCodecsDecoder.seekAndDecode(clamped, this.frameIndex).catch(console.error);
        return;
      }
      await this.webCodecsDecoder.seekAndDecode(clamped, this.frameIndex);
      this.webCodecsDecoder.pruneCache(clamped);
      return;
    }

    // <video> fallback for MP4/MOV
    if (this.videoElDecoder) {
      const ts = this.frameIndex.getTimestamp(clamped) ?? 0;
      const frame = await this.videoElDecoder.seekToTime(ts / 1_000_000);
      this.renderFrame({ ...frame, index: clamped });
    }
  }

  private stepFrame(delta: number): void {
    if (!this.metadata) return;
    this.seekToFrame(this.currentFrameIdx + delta);
  }

  // ─── Render ─────────────────────────────────────────────────────────

  private renderFrame(frame: DecodedFrame): void {
    this.preview.setRotation(this.metadata?.rotation ?? 0);
    this.preview.renderFrame(frame.imageBitmap);
    this.scrubber.setFrame(frame.index, frame.timestamp);
    this.controls.setCurrentFrame(frame.index);
    this.setLoading(false);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private enableUI(meta: VideoMetadata): void {
    this.scrubber.setMetadata(meta);
    this.controls.enable(meta.frameCount);
    this.exportPanel.enable(meta);
    this.dropZone.style.display = 'none';
  }

  private getCachedBitmap(index: number): ImageBitmap | undefined {
    if (this.webCodecsDecoder) return this.webCodecsDecoder.getFrameFromCache(index);
    if (this.gifFrames[index])  return this.gifFrames[index].imageBitmap;
    return undefined;
  }

  private setLoading(active: boolean, text = 'Loading…'): void {
    this.loadingEl.style.display = active ? 'flex' : 'none';
    this.loadingText.textContent  = text;
  }

  private inferMime(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return ({
      mp4: 'video/mp4', m4v: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      gif:  'image/gif',
    } as Record<string, string>)[ext] ?? 'video/mp4';
  }

  private disposeDecoders(): void {
    this.webCodecsDecoder?.dispose();  this.webCodecsDecoder = null;
    this.videoElDecoder?.dispose();    this.videoElDecoder   = null;
    this.webmDecoder?.dispose();       this.webmDecoder      = null;
  }
}
