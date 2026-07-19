// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { schedulePdfRenderContinuation } from './pdfRenderScheduler';

describe('schedulePdfRenderContinuation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('yields visible rendering to the next event-loop turn', () => {
    vi.useFakeTimers();
    const continueRendering = vi.fn();

    schedulePdfRenderContinuation(continueRendering, 'visible');

    expect(continueRendering).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(continueRendering).toHaveBeenCalledOnce();
  });

  it('can cancel a queued continuation', () => {
    vi.useFakeTimers();
    const continueRendering = vi.fn();
    const cancel = schedulePdfRenderContinuation(continueRendering, 'visible');

    cancel();
    vi.runOnlyPendingTimers();

    expect(continueRendering).not.toHaveBeenCalled();
  });
});
