/**
 * Preview.ts — main canvas display
 * - Renders the current frame with checkerboard backdrop
 * - Handles keyboard (←→, Shift+←→) and swipe gestures
 * - Applies video rotation metadata
 */

export type StepCallback = (delta: number) => void;

export class Preview {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onStep: StepCallback;
  private currentBitmap: ImageBitmap | null = null;
  private rotation: 0 | 90 | 180 | 270 = 0;

  // Touch tracking
  private touchStartX = 0;
  private touchStartY = 0;

  constructor(container: HTMLElement, onStep: StepCallback) {
    this.container = container;
    this.onStep = onStep;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('aria-label', 'Video frame preview');

    this.ctx = this.canvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false,
    })!;

    container.appendChild(this.canvas);
    this.bindEvents();
    this.renderPlaceholder();
  }

  setRotation(rot: 0 | 90 | 180 | 270): void {
    this.rotation = rot;
  }

  /** Render a decoded frame to the canvas */
  renderFrame(bitmap: ImageBitmap): void {
    this.currentBitmap = bitmap;
    this.draw();
  }

  private draw(): void {
    const bitmap = this.currentBitmap;
    if (!bitmap) return;

    const rot = this.rotation;
    const isRotated = rot === 90 || rot === 270;
    const displayW = isRotated ? bitmap.height : bitmap.width;
    const displayH = isRotated ? bitmap.width : bitmap.height;

    // Fit canvas to container while preserving aspect ratio
    const containerW = this.container.clientWidth;
    const containerH = this.container.clientHeight;
    const scale = Math.min(containerW / displayW, containerH / displayH, 1);

    this.canvas.width = Math.round(displayW * scale);
    this.canvas.height = Math.round(displayH * scale);

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (rot === 0) {
      ctx.drawImage(bitmap, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.save();
      ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      const drawW = rot === 90 || rot === 270 ? this.canvas.height : this.canvas.width;
      const drawH = rot === 90 || rot === 270 ? this.canvas.width : this.canvas.height;
      ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
    }
  }

  private renderPlaceholder(): void {
    this.canvas.width = 320;
    this.canvas.height = 180;
    const ctx = this.ctx;
    ctx.fillStyle = 'var(--surface-2, #141414)';
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = 'var(--text-muted, #444)';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Select a video file to begin', 160, 95);
  }

  private bindEvents(): void {
    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const big = e.shiftKey;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.onStep(big ? -10 : -1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.onStep(big ? 10 : 1);
      }
    });

    // Touch swipe
    this.canvas.addEventListener('touchstart', (e) => {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
    }, { passive: true });

    this.canvas.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - this.touchStartX;
      const dy = e.changedTouches[0].clientY - this.touchStartY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
        this.onStep(dx < 0 ? 1 : -1);
      }
    }, { passive: true });

    // Resize
    const ro = new ResizeObserver(() => this.draw());
    ro.observe(this.container);
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}
