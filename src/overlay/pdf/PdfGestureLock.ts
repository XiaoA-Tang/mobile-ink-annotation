import { dominantAxis } from "./gestureAxis";

export class PdfGestureLock {
  private locked = false;
  private singleTouchStart: { x: number; y: number } | null = null;
  private readonly scrollEl: HTMLElement;
  private savedTouchAction: string | null = null;

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
    this.scrollEl.addEventListener("wheel", this.onWheel, { passive: false });
    this.scrollEl.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.scrollEl.addEventListener("touchmove", this.onTouchMove, { passive: false, capture: true });
  }

  private detach(): void {
    if (this.savedTouchAction !== null) {
      this.scrollEl.style.touchAction = this.savedTouchAction;
      this.savedTouchAction = null;
    }
    this.scrollEl.removeEventListener("wheel", this.onWheel);
    this.scrollEl.removeEventListener("touchstart", this.onTouchStart);
    this.scrollEl.removeEventListener("touchmove", this.onTouchMove, { capture: true });
    this.singleTouchStart = null;
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
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
    if (event.touches.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      this.singleTouchStart = null;
      return;
    }
    const t = event.touches.item(0);
    this.singleTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
  };

  private onTouchMove = (event: TouchEvent): void => {
    if (!this.locked) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const t = event.touches.item(0);
    if (!t || !this.singleTouchStart) {
      this.singleTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
      return;
    }
    const dx = t.clientX - this.singleTouchStart.x;
    const dy = t.clientY - this.singleTouchStart.y;
    this.singleTouchStart = { x: t.clientX, y: t.clientY };
    if (dominantAxis(dx, dy, 8) === "horizontal") {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
