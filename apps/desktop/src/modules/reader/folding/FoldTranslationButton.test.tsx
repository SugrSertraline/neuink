// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
const mock = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock('./translateFoldLevel', () => ({ translateFoldLevel: mock.translate }));
import { FoldTranslationButton } from './FoldTranslationButton';

const record: FoldRecord = { segment_uid: 'p', source: 'Source.', evidence: [0], brief: ['Source.'],
  key: 'A result. A reason.', takeaway: 'A result.', topic: 'result', model: 'm', generated_at: '2026' };
let intersection: (entries: Array<{ isIntersecting: boolean }>) => void;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersection) { intersection = callback; }
    observe() {} disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('requests the current level only when visible and cancels when it leaves', async () => {
  mock.translate.mockImplementation(() => new Promise(() => {}));
  const view = render(<FoldTranslationButton root="root" entryId="paper" title="Title" record={record} level="key" />);
  expect(mock.translate).not.toHaveBeenCalled();
  act(() => intersection([{ isIntersecting: true }]));
  expect(mock.translate).toHaveBeenCalledTimes(1);
  expect(screen.getByText('正在生成当前详略的中文译文…')).toBeTruthy();
  const signal = mock.translate.mock.calls[0][5] as AbortSignal;
  expect(signal.aborted).toBe(false);
  act(() => intersection([{ isIntersecting: false }]));
  expect(signal.aborted).toBe(true);
  view.unmount();
});

it('shows a retry action on failure without automatically looping', async () => {
  mock.translate.mockRejectedValueOnce(new Error('model failed')).mockResolvedValueOnce(undefined);
  render(<FoldTranslationButton root="root" entryId="paper" title="Title" record={record} level="key" />);
  act(() => intersection([{ isIntersecting: true }]));
  const button = await screen.findByRole('button', { name: '重试当前详略译文' });
  expect(mock.translate).toHaveBeenCalledTimes(1);
  fireEvent.click(button);
  await waitFor(() => expect(mock.translate).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('译文已生成，正在显示…')).toBeTruthy();
});

it('restarts a canceled visible request if the reader returns to the paragraph', async () => {
  mock.translate.mockImplementation((_root, _entry, _title, _record, _level, signal: AbortSignal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
  }));
  render(<FoldTranslationButton root="root" entryId="paper" title="Title" record={record} level="key" />);
  act(() => intersection([{ isIntersecting: true }]));
  expect(mock.translate).toHaveBeenCalledTimes(1);
  act(() => { intersection([{ isIntersecting: false }]); intersection([{ isIntersecting: true }]); });
  await waitFor(() => expect(mock.translate).toHaveBeenCalledTimes(2));
  expect(screen.getByText('正在生成当前详略的中文译文…')).toBeTruthy();
});
