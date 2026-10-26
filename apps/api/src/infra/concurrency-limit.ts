/** At most `concurrency` tasks at once; at most `waiting` more wait for their turn. */
export interface ConcurrencyBounds {
  readonly concurrency: number;
  readonly waiting: number;
}

/**
 * In-process semaphore with a bounded queue, for work that occupies a scarce resource
 * (the libuv threadpool, shared with file and DNS operations). Counted per api replica.
 */
export class ConcurrencyLimit {
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly bounds: ConcurrencyBounds) {}

  /**
   * Waits for a slot, and returns the function that frees it; `null` at once if the
   * queue is full, so that the caller refuses instead of waiting without end.
   */
  async acquire(): Promise<(() => void) | null> {
    if (this.running < this.bounds.concurrency) {
      this.running += 1;
    } else {
      if (this.queue.length >= this.bounds.waiting) return null;
      // The slot is handed over by `release`: `running` does not change.
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next();
      else this.running -= 1;
    };
  }
}
