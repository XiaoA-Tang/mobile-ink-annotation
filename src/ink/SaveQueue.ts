export class SaveQueue {
  private timer: number | null = null;
  private dirty = false;
  private flushing = false;

  constructor(
    private readonly saveFn: () => Promise<void>,
    private readonly debounceMs = 800
  ) {}

  markDirty(): void {
    this.dirty = true;

    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }

    this.timer = window.setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.dirty || this.flushing) return;

    this.flushing = true;
    this.dirty = false;

    try {
      await this.saveFn();
    } catch (error) {
      console.error("Mobile Ink Annotation: failed to save", error);
      this.dirty = true;
    } finally {
      this.flushing = false;
    }
  }
}
