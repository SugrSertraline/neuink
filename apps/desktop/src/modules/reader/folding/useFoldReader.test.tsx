// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';

const mocked = vi.hoisted(() => ({ read: vi.fn(), start: vi.fn(), subscribe: vi.fn(), running: vi.fn(), snapshot: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn() }));
vi.mock('@/shared/ipc/foldingApi', () => ({ readEntryFolds: mocked.read }));
vi.mock('./foldTasks', () => ({ foldTaskKey: (root: string, id: string) => JSON.stringify([root, id]),
  foldTaskRunning: mocked.running, getFoldTaskSnapshot: mocked.snapshot, cancelFoldTask: mocked.cancel, cancelFoldSegments: vi.fn(),
  pauseFoldTask: mocked.pause, resumeFoldTask: mocked.resume, startFoldTask: mocked.start, subscribeFoldTasks: mocked.subscribe }));
import { useFoldReader } from './useFoldReader';
import { FoldGenerationError } from './foldErrors';

const segment: SourceSegment = { uid: 'a', segment_type: 'paragraph', page_idx: 0, bbox: null, text: Array(40).fill('finding').join(' '), markdown: null };
beforeEach(() => { vi.clearAllMocks(); mocked.running.mockReturnValue(false); mocked.snapshot.mockReturnValue(null); mocked.read.mockResolvedValue({}); mocked.start.mockResolvedValue(undefined); mocked.subscribe.mockReturnValue(() => {}); });

it('reopens a shared paused task without automatic generation or replacing its queue', async () => {
  mocked.running.mockReturnValue(true);
  mocked.snapshot.mockReturnValue({ status: 'paused', segments: [segment] });
  const { result, unmount } = renderHook(() => useFoldReader('root', 'paused', 'Paper', [segment], true, true, true));
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  expect(result.current.task?.status).toBe('paused');
  expect(result.current.running).toBe(true);
  expect(mocked.start).not.toHaveBeenCalled();
  act(() => { expect(result.current.start()).toBe(false); result.current.resume(); });
  expect(mocked.resume).toHaveBeenCalledExactlyOnceWith('root', 'paused');
  unmount();
  expect(mocked.cancel).not.toHaveBeenCalled();
});

it('only starts automatic work for a visible, ready reader when explicitly enabled', async () => {
  const { result, rerender } = renderHook(({ auto, visible }) => useFoldReader('root', 'paper', 'Paper', [segment], true, auto, visible),
    { initialProps: { auto: false, visible: true } });
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  expect(mocked.start).not.toHaveBeenCalled();
  rerender({ auto: true, visible: false });
  expect(mocked.start).not.toHaveBeenCalled();
  rerender({ auto: true, visible: true });
  await waitFor(() => expect(mocked.start).toHaveBeenCalledTimes(1));
  rerender({ auto: true, visible: true });
  expect(mocked.start).toHaveBeenCalledTimes(1);
});

it('keeps single-paragraph settings separate from the global level', async () => {
  const { result } = renderHook(() => useFoldReader('root', 'paper', 'Paper', [segment], true, false, true));
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  expect(result.current.level).toBe('full');
  expect(mocked.start).not.toHaveBeenCalled();
  act(() => { result.current.setLevel('key'); result.current.setOverride('a', 'full'); });
  expect(result.current.level).toBe('key'); expect(result.current.overrides.a).toBe('full');
  act(() => result.current.setLevel('off'));
  expect(result.current.overrides.a).toBe('full');
  act(() => result.current.setOverride('a', 'inherit'));
  expect(result.current.overrides.a).toBeUndefined();
});

it('respects an initial sentence mode without resetting local choices when preferences change', async () => {
  const { result, rerender } = renderHook(({ entryId, initialLevel }) => useFoldReader('root', entryId, 'Paper', [segment], true, false, true, initialLevel),
    { initialProps: { entryId: 'first', initialLevel: 'off' as 'off' | 'full' } });
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  expect(result.current.level).toBe('off');
  act(() => { result.current.setLevel('key'); result.current.setOverride('a', 'brief'); });
  rerender({ entryId: 'first', initialLevel: 'full' });
  expect(result.current.level).toBe('key');
  expect(result.current.overrides.a).toBe('brief');
  rerender({ entryId: 'second', initialLevel: 'full' });
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  expect(result.current.level).toBe('full');
  expect(result.current.overrides).toEqual({});
  expect(mocked.start).not.toHaveBeenCalled();
});

it('does not start automatic or forced generation for a short paragraph', async () => {
  const short = { ...segment, text: 'A short paragraph.' };
  const { result } = renderHook(() => useFoldReader('root', 'paper', 'Paper', [short], true, true, true));
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  expect(mocked.start).not.toHaveBeenCalled();
  act(() => { expect(result.current.start([short], true)).toBe(false); });
  expect(result.current.error).toContain('较短');
  expect(mocked.start).not.toHaveBeenCalled();
});

it('reports a save failure instead of blaming model configuration', async () => {
  mocked.start.mockRejectedValueOnce(new FoldGenerationError('save'));
  const { result } = renderHook(() => useFoldReader('root', 'paper', 'Paper', [segment], true, false, true));
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  act(() => { result.current.start(); });
  await waitFor(() => expect(result.current.error).toContain('保存失败'));
  expect(result.current.error).not.toContain('模型配置');
});

it('keeps full document context available when the user selects a single paragraph', async () => {
  const heading: SourceSegment = { ...segment, uid: 'h', segment_type: 'heading', text: 'Results' };
  const document = [heading, segment];
  const { result } = renderHook(() => useFoldReader('root', 'paper', 'Paper', document, true, false, true));
  await waitFor(() => expect(result.current.loadState).toBe('ready'));
  act(() => { result.current.start([segment]); });
  expect(mocked.start).toHaveBeenCalledWith('root', 'paper', 'Paper', [segment], { force: false, documentSegments: document });
});
