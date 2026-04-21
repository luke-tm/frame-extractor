/**
 * ExportPanel.ts — format selector, quality slider, bg color picker, export buttons
 */

import type { ExportOptions, BatchExportOptions, VideoMetadata } from '../types';

export type ExportFrameCallback = (opts: ExportOptions) => void;
export type ExportBatchCallback = (opts: BatchExportOptions) => void;

export class ExportPanel {
  private el: HTMLElement;
  private onExportFrame: ExportFrameCallback;
  private onExportBatch: ExportBatchCallback;
  private meta: VideoMetadata | null = null;
  private batchRange: [number, number] | null = null;

  // DOM refs
  private formatSelect!: HTMLSelectElement;
  private qualityRow!: HTMLElement;
  private qualityInput!: HTMLInputElement;
  private qualityLabel!: HTMLElement;
  private bgRow!: HTMLElement;
  private bgInput!: HTMLInputElement;
  private exportFrameBtn!: HTMLButtonElement;
  private exportBatchBtn!: HTMLButtonElement;
  private batchLabel!: HTMLElement;
  private progressEl!: HTMLElement;

  constructor(
    container: HTMLElement,
    onExportFrame: ExportFrameCallback,
    onExportBatch: ExportBatchCallback
  ) {
    this.onExportFrame = onExportFrame;
    this.onExportBatch = onExportBatch;
    this.el = document.createElement('div');
    this.el.className = 'export-panel';
    container.appendChild(this.el);
    this.render();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="export-panel__section">
        <label class="export-panel__label" for="format-select">Format</label>
        <select class="export-panel__select" id="format-select" disabled>
          <option value="png">PNG — lossless, preserves alpha</option>
          <option value="webp">WebP — lossy/lossless, preserves alpha</option>
          <option value="jpeg">JPEG — lossy, no alpha</option>
        </select>
      </div>

      <div class="export-panel__section export-panel__quality-row">
        <label class="export-panel__label" for="quality-input">
          Quality <span class="export-panel__quality-val">0.92</span>
        </label>
        <input
          type="range"
          id="quality-input"
          class="export-panel__range"
          min="0.1" max="1.0" step="0.01" value="0.92"
          disabled
        >
      </div>

      <div class="export-panel__section export-panel__bg-row" style="display:none">
        <label class="export-panel__label" for="bg-input">Background</label>
        <input type="color" id="bg-input" class="export-panel__color" value="#ffffff" disabled>
        <span class="export-panel__label">for JPEG alpha flatten</span>
      </div>

      <div class="export-panel__actions">
        <button class="export-panel__btn export-panel__btn--primary" disabled>
          Export Frame
        </button>
        <button class="export-panel__btn export-panel__btn--secondary" disabled>
          Export Range
        </button>
      </div>

      <div class="export-panel__batch-label" style="display:none"></div>
      <div class="export-panel__progress" style="display:none">
        <div class="export-panel__progress-bar"></div>
        <span class="export-panel__progress-text">0 / 0</span>
      </div>
    `;

    this.formatSelect = this.el.querySelector('#format-select')!;
    this.qualityRow = this.el.querySelector('.export-panel__quality-row')!;
    this.qualityInput = this.el.querySelector('#quality-input')!;
    this.qualityLabel = this.el.querySelector('.export-panel__quality-val')!;
    this.bgRow = this.el.querySelector('.export-panel__bg-row')!;
    this.bgInput = this.el.querySelector('#bg-input')!;
    this.exportFrameBtn = this.el.querySelector('.export-panel__btn--primary')!;
    this.exportBatchBtn = this.el.querySelector('.export-panel__btn--secondary')!;
    this.batchLabel = this.el.querySelector('.export-panel__batch-label')!;
    this.progressEl = this.el.querySelector('.export-panel__progress')!;

    this.formatSelect.addEventListener('change', () => this.updateFormatUI());
    this.qualityInput.addEventListener('input', () => {
      this.qualityLabel.textContent = parseFloat(this.qualityInput.value).toFixed(2);
    });

    this.exportFrameBtn.addEventListener('click', () => {
      this.onExportFrame(this.getOpts());
    });

    this.exportBatchBtn.addEventListener('click', () => {
      if (!this.batchRange) return;
      const [start, end] = this.batchRange;
      this.onExportBatch({ ...this.getOpts(), startFrame: start, endFrame: end });
    });
  }

  enable(meta: VideoMetadata): void {
    this.meta = meta;
    this.formatSelect.disabled = false;
    this.qualityInput.disabled = false;
    this.bgInput.disabled = false;
    this.exportFrameBtn.disabled = false;
    this.updateFormatUI();
  }

  setBatchRange(start: number, end: number): void {
    this.batchRange = [start, end];
    this.exportBatchBtn.disabled = false;
    this.batchLabel.style.display = 'block';
    this.batchLabel.textContent = `Range: frames ${start}–${end} (${end - start + 1} frames)`;
  }

  showProgress(done: number, total: number): void {
    this.progressEl.style.display = 'flex';
    const pct = total > 0 ? (done / total) * 100 : 0;
    (this.progressEl.querySelector('.export-panel__progress-bar') as HTMLElement).style.width = `${pct}%`;
    (this.progressEl.querySelector('.export-panel__progress-text') as HTMLElement).textContent = `${done} / ${total}`;
    if (done >= total) {
      setTimeout(() => { this.progressEl.style.display = 'none'; }, 1500);
    }
  }

  private updateFormatUI(): void {
    const fmt = this.formatSelect.value as 'png' | 'webp' | 'jpeg';
    const needsQuality = fmt !== 'png';
    const needsBg = fmt === 'jpeg';
    this.qualityRow.style.display = needsQuality ? 'flex' : 'none';
    this.bgRow.style.display = needsBg ? 'flex' : 'none';
  }

  private getOpts(): ExportOptions {
    return {
      format: this.formatSelect.value as 'jpeg' | 'png' | 'webp',
      quality: parseFloat(this.qualityInput.value),
      bgColor: this.bgInput.value,
    };
  }
}
