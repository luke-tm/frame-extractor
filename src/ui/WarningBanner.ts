/**
 * WarningBanner.ts — non-modal persistent banners for fallback path / HDR / memory
 */

export type BannerKind = 'alpha-lost' | 'hdr' | 'memory' | 'error';

interface Banner {
  kind: BannerKind;
  message: string;
  el: HTMLElement;
}

export class WarningBanner {
  private container: HTMLElement;
  private banners = new Map<BannerKind, Banner>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(kind: BannerKind, message: string): void {
    if (this.banners.has(kind)) return;

    const el = document.createElement('div');
    el.className = `banner banner--${kind}`;
    el.setAttribute('role', 'alert');

    const icon = kind === 'error' ? '⚠' : kind === 'hdr' ? 'HDR' : kind === 'memory' ? '⚠' : '⚠';
    el.innerHTML = `
      <span class="banner__icon">${icon}</span>
      <span class="banner__message">${message}</span>
      <button class="banner__dismiss" aria-label="Dismiss">✕</button>
    `;

    el.querySelector('.banner__dismiss')!.addEventListener('click', () => {
      this.dismiss(kind);
    });

    this.container.appendChild(el);
    this.banners.set(kind, { kind, message, el });
  }

  dismiss(kind: BannerKind): void {
    const banner = this.banners.get(kind);
    if (!banner) return;
    banner.el.remove();
    this.banners.delete(kind);
  }

  dismissAll(): void {
    for (const kind of this.banners.keys()) {
      this.dismiss(kind);
    }
  }
}
