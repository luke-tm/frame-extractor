/**
 * Scrubber.ts — frame timeline, position counter, jump input
 */

import { formatTimestamp } from '../codec/frameIndex';
import type { VideoMetadata } from '../types';

export type SeekCallback = (frameIndex: number) => void;

export class Scrubber {
  private el: HTMLElement;
  private onSeek: SeekCallback;
  private totalFrames = 0;
  private currentFrame = 0;
  private meta: VideoMetadata | null = null;

  // DOM refs
  private counterEl!: HTMLElement;
  private rangeEl!: HTMLInputElement;
  private jumpInput!: HTMLInputElement;
  private jumpBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, onSeek: SeekCallback) {
    this.onSeek = onSeek;
    this.el = document.createElement('div');
    this.el.className = 'scrubber';
    container.appendChild(this.el);
    this.render();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="scrubber__counter" aria-live="polite">—</div>
      <div class="scrubber__track-row">
        <input
          type="range"
          class="scrubber__range"
          min="0" max="0" value="0"
          aria-label="Frame position"
          disabled
        >
      </div>
      <div class="scrubber__jump-row">
        <label class="scrubber__label" for="jump-input">Go to frame</label>
        <input
          type="number"
          id="jump-input"
          class="scrubber__jump-input"
          min="0" step="1"
          placeholder="0"
          disabled
        >
        <button class="scrubber__jump-btn" disabled>Go</button>
      </div>
    `;

    this.counterEl = this.el.querySelector('.scrubber__counter')!;
    this.rangeEl = this.el.querySelector('.scrubber__range')!;
    this.jumpInput = this.el.querySelector('.scrubber__jump-input')!;
    this.jumpBtn = this.el.querySelector('.scrubber__jump-btn')!;

    this.rangeEl.addEventListener('input', () => {
      const idx = parseInt(this.rangeEl.value, 10);
      this.onSeek(idx);
    });

    this.jumpBtn.addEventListener('click', () => {
      const val = parseInt(this.jumpInput.value, 10);
      if (!isNaN(val)) {
        const clamped = Math.max(0, Math.min(this.totalFrames - 1, val));
        this.onSeek(clamped);
      }
    });

    this.jumpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.jumpBtn.click();
    });
  }

  setMetadata(meta: VideoMetadata): void {
    this.meta = meta;
    this.totalFrames = meta.frameCount;
    this.rangeEl.max = String(meta.frameCount - 1);
    this.rangeEl.disabled = false;
    this.jumpInput.disabled = false;
    this.jumpInput.max = String(meta.frameCount - 1);
    this.jumpBtn.disabled = false;
    this.updateCounter(0);
  }

  setFrame(index: number, timestamp: number): void {
    this.currentFrame = index;
    this.rangeEl.value = String(index);
    this.updateCounter(timestamp);
  }

  private updateCounter(timestamp: number): void {
    const meta = this.meta;
    if (!meta) { this.counterEl.textContent = '—'; return; }
    const ts = formatTimestamp(timestamp);
    const dim = `${meta.width}×${meta.height}`;
    this.counterEl.textContent =
      `Frame ${this.currentFrame + 1} / ${this.totalFrames} · ${ts} · ${dim} · ${meta.codec}`;
  }
}
