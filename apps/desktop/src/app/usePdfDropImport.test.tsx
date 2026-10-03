// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { droppedPdfFiles, usePdfDropImport } from './usePdfDropImport';

type DropPayload =
  | { type: 'enter' | 'over' | 'leave'; position: { x: number; y: number } }
  | { type: 'drop'; position: { x: number; y: number }; paths: string[] };

const mock = vi.hoisted(() => ({
  listener: null as null | ((event: { payload: DropPayload }) => void),
  unlisten: vi.fn(),
  isTauri: vi.fn(() => true)
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mock.isTauri }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (listener: typeof mock.listener) => {
      mock.listener = listener;
      return mock.unlisten;
    }
  })
}));

function emit(payload: DropPayload) {
  mock.listener?.({ payload });
}

function options(createEntry = vi.fn(async () => ({ createdWithPdf: true, entryId: 'entry', parseSubmissionFailed: false }))) {
  return {
    workspaceRoot: 'C:\\library', workspaceReady: true, parserEndpoint: 'https://parser.example', parserApiKey: 'test-key',
    createEntry, notify: vi.fn(() => 'pending'), dismiss: vi.fn()
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.listener = null;
  mock.isTauri.mockReturnValue(true);
});
afterEach(cleanup);

it('derives one entry title per PDF and skips unsupported or repeated paths', () => {
  expect(droppedPdfFiles(['C:\\papers\\First.PDF', '/papers/second study.pdf', 'C:\\papers\\FIRST.pdf', '/papers/image.png', '/papers/.pdf']))
    .toEqual({
      files: [
        { path: 'C:\\papers\\First.PDF', title: 'First' },
        { path: '/papers/second study.pdf', title: 'second study' }
      ],
      skipped: 3
    });
});

it('imports dropped PDFs sequentially and reports partial failure', async () => {
  let releaseFirst: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const createEntry = vi.fn()
    .mockImplementationOnce(async () => { await first; return { createdWithPdf: true, entryId: 'one' }; })
    .mockRejectedValueOnce(new Error('unreadable'))
    .mockResolvedValueOnce({ createdWithPdf: true, entryId: 'three' });
  const configured = options(createEntry);
  const view = renderHook(() => usePdfDropImport(configured));
  await act(async () => {});
  act(() => emit({ type: 'enter', position: { x: 10, y: 10 } }));
  expect(view.result.current.dragActive).toBe(true);
  act(() => emit({ type: 'drop', position: { x: 10, y: 10 }, paths: ['a.pdf', 'b.PDF', 'c.pdf', 'note.txt'] }));
  expect(view.result.current.dragActive).toBe(false);
  expect(createEntry).toHaveBeenCalledTimes(1);
  expect(view.result.current.progress).toEqual({ completed: 0, total: 3, root: 'C:\\library', id: expect.any(String), startedAt: expect.any(Number) });
  await act(async () => { releaseFirst?.(); });
  await waitFor(() => expect(createEntry).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(view.result.current.progress).toBeNull());
  expect(createEntry.mock.calls.map(([request]) => request.title)).toEqual(['a', 'b', 'c']);
  expect(configured.dismiss).toHaveBeenCalledWith('pending');
  expect(configured.notify).toHaveBeenLastCalledWith(expect.objectContaining({
    title: 'PDF 导入部分失败',
    description: expect.stringContaining('成功 2 个；失败 1 个：b')
  }));
  view.unmount();
  await act(async () => {});
  expect(mock.unlisten).toHaveBeenCalledOnce();
});

it('leaves the existing create-entry drop zone alone', async () => {
  const configured = options();
  const zone = document.createElement('div');
  zone.dataset.nativeFileDropZone = '';
  zone.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100 } as DOMRect);
  document.body.append(zone);
  const view = renderHook(() => usePdfDropImport(configured));
  await act(async () => {});
  act(() => emit({ type: 'enter', position: { x: 20, y: 20 } }));
  expect(view.result.current.dragActive).toBe(false);
  act(() => emit({ type: 'drop', position: { x: 20, y: 20 }, paths: ['result.zip'] }));
  expect(configured.createEntry).not.toHaveBeenCalled();
  act(() => emit({ type: 'drop', position: { x: 20, y: 20 }, paths: ['paper.pdf'] }));
  await waitFor(() => expect(configured.createEntry).toHaveBeenCalledOnce());
  view.unmount();
  zone.remove();
});

it('does not import without a ready workspace or while another batch is pending', async () => {
  const absent = { ...options(), workspaceRoot: null };
  const first = renderHook(() => usePdfDropImport(absent));
  await act(async () => {});
  act(() => emit({ type: 'drop', position: { x: 10, y: 10 }, paths: ['paper.pdf'] }));
  expect(absent.createEntry).not.toHaveBeenCalled();
  expect(absent.notify).toHaveBeenCalledWith(expect.objectContaining({ title: '无法导入 PDF' }));
  first.unmount();

  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const createEntry = vi.fn(async () => { await pending; return { createdWithPdf: true, entryId: 'entry' }; });
  const configured = options(createEntry);
  const second = renderHook(() => usePdfDropImport(configured));
  await act(async () => {});
  act(() => emit({ type: 'drop', position: { x: 10, y: 10 }, paths: ['one.pdf'] }));
  act(() => emit({ type: 'drop', position: { x: 10, y: 10 }, paths: ['two.pdf'] }));
  expect(createEntry).toHaveBeenCalledTimes(1);
  expect(configured.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'PDF 正在导入' }));
  await act(async () => { release?.(); });
  second.unmount();
});

it('stops before importing the next file when the workspace changes', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const createEntry = vi.fn(async () => { await pending; return { createdWithPdf: true, entryId: 'first' }; });
  const configured = options(createEntry);
  const view = renderHook(({ workspaceRoot }) => usePdfDropImport({ ...configured, workspaceRoot }), {
    initialProps: { workspaceRoot: 'C:\\library' }
  });
  await act(async () => {});
  act(() => emit({ type: 'drop', position: { x: 10, y: 10 }, paths: ['first.pdf', 'second.pdf'] }));
  view.rerender({ workspaceRoot: 'C:\\other-library' });
  await act(async () => { release?.(); });
  expect(createEntry).toHaveBeenCalledOnce();
  expect(configured.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'PDF 导入已中断' }));
  view.unmount();
});
