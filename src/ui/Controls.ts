/**
 * Controls.ts — frame step buttons, batch range selection
 */

export type StepCallback = (delta: number) => void;
export type BatchSelectCallback = (start: number, end: number) => void;

export class Controls {
  private el: HTMLElement;
  private onStep: StepCallback;
  private onBatchSelect: BatchSelectCallback;
  private totalFrames = 0;
  private currentFrame = 0;

  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private prev10Btn!: HTMLButtonElement;
  private next10Btn!: HTMLButtonElement;
  private batchStartInput!: HTMLInputElement;
  private batchEndInput!: HTMLInputElement;
  private batchBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, onStep: StepCallback, onBatchSelect: BatchSelectCallback) {
    this.onStep = onStep;
    this.onBatchSelect = onBatchSelect;
    this.el = document.createElement('div');
    this.el.className = 'controls';
    container.appendChild(this.el);
    this.render();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="controls__step-row">
        <button class="controls__btn controls__btn--step" data-delta="-10" disabled aria-label="Back 10 frames">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9 3L4 8l5 5M13 3L8 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>−10</span>
        </button>
        <button class="controls__btn controls__btn--step controls__btn--primary" data-delta="-1" disabled aria-label="Previous frame">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>Prev</span>
        </button>
        <button class="controls__btn controls__btn--step controls__btn--primary" data-delta="1" disabled aria-label="Next frame">
          <span>Next</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="controls__btn controls__btn--step" data-delta="10" disabled aria-label="Forward 10 frames">
          <span>+10</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M7 3l5 5-5 5M3 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="controls__batch-row">
        <span class="controls__label">Batch export range</span>
        <div class="controls__batch-inputs">
          <input type="number" class="controls__batch-input" id="batch-start" min="0" step="1" placeholder="Start" disabled>
          <span class="controls__batch-sep">–</span>
          <input type="number" class="controls__batch-input" id="batch-end" min="0" step="1" placeholder="End" disabled>
          <button class="controls__btn controls__btn--batch" disabled>Select Range</button>
        </div>
      </div>
    `;

    // Step buttons
    this.el.querySelectorAll<HTMLButtonElement>('[data-delta]').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.delta!, 10);
        this.onStep(delta);
      });
    });

    this.batchStartInput = this.el.querySelector('#batch-start')!;
    this.batchEndInput = this.el.querySelector('#batch-end')!;
    this.batchBtn = this.el.querySelector('.controls__btn--batch')!;

    this.batchBtn.addEventListener('click', () => {
      const s = parseInt(this.batchStartInput.value, 10);
      const e = parseInt(this.batchEndInput.value, 10);
      if (!isNaN(s) && !isNaN(e) && s <= e) {
        this.onBatchSelect(
          Math.max(0, s),
          Math.min(this.totalFrames - 1, e)
        );
      }
    });
  }

  enable(frameCount: number): void {
    this.totalFrames = frameCount;
    this.el.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false);
    this.el.querySelectorAll<HTMLInputElement>('input').forEach(i => i.disabled = false);
    this.batchEndInput.value = String(frameCount - 1);
    this.batchStartInput.max = String(frameCount - 1);
    this.batchEndInput.max = String(frameCount - 1);
  }

  setCurrentFrame(index: number): void {
    this.currentFrame = index;
  }
}
