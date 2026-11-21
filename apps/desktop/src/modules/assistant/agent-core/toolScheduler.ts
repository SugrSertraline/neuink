export const MAX_PARALLEL_TOOLS = 4;

type Job = {
  parallel: boolean;
  start: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

/** FIFO barriers: readers may overlap, but no request can overtake an exclusive job. */
export class ToolScheduler {
  private readonly queue: Job[] = [];
  private readonly controller = new AbortController();
  private readonly waiters = new Set<() => void>();
  private active = 0;
  private exclusive = false;
  private failure?: { error: unknown };

  constructor(private readonly limit = MAX_PARALLEL_TOOLS,
    private readonly isFatal: (error: unknown) => boolean = () => true) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid tool concurrency limit.');
  }

  run<T>(parallel: boolean, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.failure) return Promise.reject(this.failure.error);
    const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ parallel, start: async () => { combined.throwIfAborted(); return work(combined); },
        resolve: value => resolve(value as T), reject });
      this.drain();
    });
  }

  async settled(): Promise<void> {
    if (this.active || this.queue.length) await new Promise<void>(resolve => { this.waiters.add(resolve); });
    if (this.failure) throw this.failure.error;
  }

  private stop(error: unknown) {
    if (this.failure) return;
    this.failure = { error };
    this.controller.abort(error);
    for (const job of this.queue.splice(0)) job.reject(error);
  }

  private drain() {
    while (!this.failure && !this.exclusive && this.active < this.limit && this.queue.length) {
      if (!this.queue[0].parallel && this.active) break;
      const job = this.queue.shift()!;
      this.active++;
      this.exclusive = !job.parallel;
      void Promise.resolve().then(job.start).then(job.resolve, error => {
        if (this.isFatal(error)) this.stop(error);
        job.reject(error);
      }).finally(() => {
        this.active--;
        if (!job.parallel) this.exclusive = false;
        this.drain();
      });
    }
    if (!this.active && !this.queue.length) {
      for (const resolve of this.waiters) resolve();
      this.waiters.clear();
    }
  }
}
