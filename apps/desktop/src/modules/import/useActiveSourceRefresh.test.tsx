// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useActiveSourceRefresh } from './useActiveSourceRefresh';

describe('useActiveSourceRefresh', () => {
  it('scans when opened and keeps rapid focus changes from rescanning', async () => {
    const load = vi.fn(async () => undefined);
    const reset = vi.fn();
    const view = renderHook(({ active, directory }) => useActiveSourceRefresh(active, directory, false, load, reset), {
      initialProps: { active: false, directory: 'source' },
    });
    expect(load).not.toHaveBeenCalled();
    view.rerender({ active: true, directory: 'source' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(load).toHaveBeenCalledTimes(1);
    view.rerender({ active: false, directory: 'source' });
    view.rerender({ active: true, directory: 'source' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
