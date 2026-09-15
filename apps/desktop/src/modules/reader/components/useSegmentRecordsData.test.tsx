// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PdfReaderResponse } from '@/shared/ipc/workspaceApi';
import { useSegmentRecordsData } from './useSegmentRecordsData';
import { SegmentRecordsLoadStatus } from './SegmentRecordsLoadStatus';

afterEach(cleanup);
const data = { segments: [], segment_notes: [], annotations: [] } as unknown as PdfReaderResponse;
const options = { entryId: 'a', workspaceRoot: 'workspace-a', enabled: true, refreshKey: '0' };

it('reports an initial failure and supports retry, not an endless spinner', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('read denied')).mockResolvedValue(data);
  const { result } = renderHook(() => useSegmentRecordsData({ ...options, load }));
  await waitFor(() => expect(result.current.error).toBe('read denied'));
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBeNull();
  render(<SegmentRecordsLoadStatus error={result.current.error} loading={false} hasData={false} onRetry={result.current.retry} />);
  expect(screen.getByRole('alert').textContent).toContain('片段记录读取失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(result.current.data).toBe(data));
  expect(result.current.error).toBeNull();
});

it('retains the loaded data during refresh and after a refresh failure', async () => {
  const load = vi.fn().mockResolvedValueOnce(data).mockRejectedValue(new Error('refresh failed'));
  const { result, rerender } = renderHook(({ refreshKey }) => useSegmentRecordsData({ ...options, refreshKey, load }), { initialProps: { refreshKey: '0' } });
  await waitFor(() => expect(result.current.data).toBe(data));
  rerender({ refreshKey: '1' });
  expect(result.current.data).toBe(data);
  await waitFor(() => expect(result.current.error).toBe('refresh failed'));
  expect(result.current.data).toBe(data);
});

it('ignores old workspace responses even when the entry id is unchanged', async () => {
  let resolveOld!: (value: PdfReaderResponse) => void;
  const oldData = { ...data };
  const load = vi.fn().mockImplementationOnce(() => new Promise<PdfReaderResponse>((resolve) => { resolveOld = resolve; })).mockResolvedValue(data);
  const { result, rerender } = renderHook(({ workspaceRoot }) => useSegmentRecordsData({ ...options, workspaceRoot, load }), { initialProps: { workspaceRoot: 'old' } });
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  rerender({ workspaceRoot: 'new' });
  expect(result.current.data).toBeNull();
  await waitFor(() => expect(result.current.data).toBe(data));
  await act(async () => resolveOld(oldData));
  expect(result.current.data).toBe(data);
});
