import { dominantAxis } from "./gestureAxis";

const AXIS_SLOP = 8;
const CLAMP_EPSILON = 0.5;

export class PdfGestureLock {
  private locked = false;
  private singleTouchStart: { x: number; y: number } | null = null;
  private readonly scrollEl: HTMLElement;
  private savedTouchAction: string | null = null;
  private lockedScrollLeft: number | null = null;

  constructor(scrollEl: HTMLElement) {
    this.scrollEl = scrollEl;
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) this.attach();
    else this.detach();
  }

  destroy(): void {
    this.locked = false;
    this.detach();
  }

  private attach(): void {
    this.savedTouchAction = this.scrollEl.style.touchAction;
    this.scrollEl.style.touchAction = "pan-y";
    this.lockedScrollLeft = this.scrollEl.scrollLeft;

    window.addEventListener("touchstart", this.onTouchStart, { passive: false, capture: true });
    window.addEventListener("touchmove", this.onTouchMove, { passive: false, capture: true });
    window.addEventListener("wheel", this.onWheel, { passive: false, capture: true });
    this.scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
  }

  private detach(): void {
    if (this.savedTouchAction !== null) {
      this.scrollEl.style.touchAction = this.savedTouchAction;
      this.savedTouchAction = null;
    }
    this.lockedScrollLeft = null;
    window.removeEventListener("touchstart", this.onTouchStart, { capture: true });
    window.removeEventListener("touchmove", this.onTouchMove, { capture: true });
    window.removeEventListener("wheel", this.onWheel, { capture: true });
    this.scrollEl.removeEventListener("scroll", this.onScroll);
    this.singleTouchStart = null;
  }

  private onScroll = (): void => {
    if (!this.locked) return;
    const locked = this.lockedScrollLeft;
    if (locked === null) return;
    const el = this.scrollEl;
    if (Math.abs(el.scrollLeft - locked) > CLAMP_EPSILON) {
      el.scrollLeft = locked;
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
    if (!this.scrollEl.contains(event.target as Node)) return;
    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.deltaX !== 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (!this.locked) return;
    const t = event.touches.item(0) ?? event.changedTouches.item(0);
    if (!t) return;
    if ((t as Touch & { touchType?: string }).touchType === "stylus") return;
    if (!this.scrollEl.contains(event.target as Node)) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      this.singleTouchStart = null;
      return;
    }
    this.singleTouchStart = { x: t.clientX, y: t.clientY };
  };

  private onTouchMove = (event: TouchEvent): void => {
    if (!this.locked) return;
    const t = event.touches.item(0);
    if (!t) return;
    if ((t as Touch & { touchType?: string }).touchType === "stylus") return;
    if (!this.scrollEl.contains(event.target as Node)) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!this.singleTouchStart) {
      this.singleTouchStart = { x: t.clientX, y: t.clientY };
      return;
    }
    const dx = t.clientX - this.singleTouchStart.x;
    const dy = t.clientY - this.singleTouchStart.y;
    this.singleTouchStart = { x: t.clientX, y: t.clientY };
    if (dominantAxis(dx, dy, AXIS_SLOP) === "horizontal") {
      event.preventDefault();
      event.stopPropagation();
      if (this.lockedScrollLeft !== null) {
        this.scrollEl.scrollLeft = this.lockedScrollLeft;
      }
    }
  };
}
