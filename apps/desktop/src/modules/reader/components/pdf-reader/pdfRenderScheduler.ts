export type PdfRenderPriority = 'preload' | 'visible';

export function schedulePdfRenderContinuation(
  continueRendering: () => void,
  priority: PdfRenderPriority
) {
  let cancelled = false;
  const run = () => {
    if (!cancelled) {
      continueRendering();
    }
  };

  if (priority === 'preload' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 250 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(handle);
    };
  }

  const handle = window.setTimeout(run, priority === 'visible' ? 0 : 40);
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}
