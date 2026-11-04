/** Owned by the shared entry task, so closing a reader never loses its queue. */
export function createFoldPauseGate() {
  let paused = false;
  const waiting = new Set<() => void>();
  const wake = () => { for (const resume of [...waiting]) resume(); };
  return {
    get paused() { return paused; },
    pause() { paused = true; },
    resume() { paused = false; wake(); },
    // Canceling queued paragraphs must also let idle workers re-check the queue.
    wake,
    wait(signal: AbortSignal): Promise<void> {
      if (!paused || signal.aborted) return Promise.resolve();
      return new Promise(resolve => {
        const resume = () => {
          waiting.delete(resume);
          signal.removeEventListener('abort', resume);
          resolve();
        };
        waiting.add(resume);
        signal.addEventListener('abort', resume, { once: true });
      });
    }
  };
}

export type FoldPauseGate = ReturnType<typeof createFoldPauseGate>;
