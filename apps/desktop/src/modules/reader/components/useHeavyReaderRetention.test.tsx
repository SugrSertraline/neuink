// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { useHeavyReaderRetention } from './useHeavyReaderRetention';
import { setSegmentEditorDirty } from './segmentEditorDirtyRegistry';
import { HEAVY_READER_IDLE_UNMOUNT_MS as IDLE, HEAVY_READER_SWEEP_INTERVAL_MS as SWEEP } from './readerRetention';

afterEach(() => { cleanup(); vi.useRealTimers(); setSegmentEditorDirty('pdf:a', 'owner', false); });
const layout: WorkspaceSurfaceLayout = { focusedPane: 'left', left: { kind: 'library' }, leftTabs: [{ kind: 'library' }, { kind: 'pdf', entryId: 'a' }], right: null, rightTabs: [] };

it('retains dirty hidden readers and restarts their idle period after saving', () => {
  vi.useFakeTimers();
  setSegmentEditorDirty('entry-content:a|pdf', 'owner', true);
  const { result } = renderHook(() => useHeavyReaderRetention(layout));
  act(() => vi.advanceTimersByTime(IDLE * 2));
  expect(result.current.has('pdf:a')).toBe(false);
  setSegmentEditorDirty('pdf:a', 'owner', false);
  act(() => vi.advanceTimersByTime(SWEEP));
  act(() => vi.advanceTimersByTime(IDLE - SWEEP));
  expect(result.current.has('pdf:a')).toBe(false);
  act(() => vi.advanceTimersByTime(SWEEP));
  expect(result.current.has('pdf:a')).toBe(true);
});

it('does not expire an active reader even after a long period', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useHeavyReaderRetention({ ...layout, left: { kind: 'pdf', entryId: 'a' } }));
  act(() => vi.advanceTimersByTime(IDLE * 3));
  expect(result.current.size).toBe(0);
});
