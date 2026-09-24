// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsAutosave } from './useSettingsAutosave';
import { hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(30); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('settings write ownership', () => {
  it('flushes pending settings before closing, and blocks close on failed writes', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => {
      const [saved, setSaved] = useState('old');
      return useSettingsAutosave({ value: 'draft', savedValue: saved, equal: Object.is, save, onSaved: setSaved, closeScope: 'settings', delay: 500 });
    });
    expect(hasUnsavedSegmentEditors('settings')).toBe(true);
    await act(async () => { expect(await saveSegmentEditorsBeforeClose('settings')).toBe(false); });
    expect(result.current.dirty).toBe(true);
    expect(hasUnsavedSegmentEditors('settings')).toBe(true);
    await act(async () => { expect(await saveSegmentEditorsBeforeClose('settings')).toBe(true); });
    expect(hasUnsavedSegmentEditors('settings')).toBe(false);
    await tick(); expect(save).toHaveBeenCalledTimes(2);
    unmount(); expect(hasUnsavedSegmentEditors('settings')).toBe(false);
  });
  it('serializes writes and preserves edits made while a save is pending', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [value, setValue] = useState('original');
      const [saved, setSaved] = useState('original');
      return { setValue, saved, ...useSettingsAutosave({ value, savedValue: saved, equal: Object.is, save, onSaved: setSaved, delay: 20 }) };
    });
    await tick(); expect(save).not.toHaveBeenCalled();
    act(() => result.current.setValue('first')); await tick();
    act(() => result.current.setValue('second')); await tick();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve()); await tick();
    expect(save.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    expect(result.current.saved).toBe('second'); expect(result.current.dirty).toBe(false);
  });
  it('keeps a failed draft and retries only after explicit retry or another edit', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [saved, setSaved] = useState('old');
      return useSettingsAutosave({ value: 'draft', savedValue: saved, equal: Object.is, save, onSaved: setSaved, delay: 20 });
    });
    await tick(); expect(result.current.error).toBe('disk unavailable'); expect(result.current.dirty).toBe(true);
    await tick(); expect(save).toHaveBeenCalledTimes(1);
    act(() => result.current.retry()); await tick();
    expect(save).toHaveBeenCalledTimes(2); expect(result.current.dirty).toBe(false);
  });
  it('does not apply a late response to a different library', async () => {
    const first = deferred(); const onSaved = vi.fn(); const save = vi.fn(() => first.promise);
    const { rerender } = renderHook(({ scope, enabled }) => useSettingsAutosave({ value: 'draft', savedValue: 'old', equal: Object.is, scope, enabled, save, onSaved, delay: 20 }), { initialProps: { scope: 'a', enabled: true } });
    await tick(); rerender({ scope: 'b', enabled: false });
    await act(async () => first.resolve());
    expect(onSaved).not.toHaveBeenCalled();
  });
});
