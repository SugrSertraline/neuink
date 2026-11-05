/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readPdfBytes = vi.hoisted(() => vi.fn());

vi.mock('@/shared/ipc/workspaceApi', () => ({ readPdfBytes }));

import { usePdfBytes } from './usePdfBytes';

describe('usePdfBytes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reloads bytes into a new array when the content hash changes at the same path', async () => {
    readPdfBytes
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer)
      .mockResolvedValueOnce(new Uint8Array([9, 8]).buffer);
    const { result, rerender } = renderHook(
      ({ hash }: { hash: string }) => usePdfBytes('C:/workspace/paper.pdf', hash),
      { initialProps: { hash: 'old-hash' } }
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstBytes = result.current.status === 'ready' ? result.current.bytes : null;

    rerender({ hash: 'new-hash' });
    await waitFor(() => expect(result.current.status === 'ready' && result.current.bytes !== firstBytes).toBe(true));

    expect(readPdfBytes).toHaveBeenCalledTimes(2);
    expect(readPdfBytes).toHaveBeenNthCalledWith(2, 'C:/workspace/paper.pdf');
    if (result.current.status === 'ready') {
      expect([...result.current.bytes]).toEqual([9, 8]);
    }
  });

  it('retries the same local PDF after an IPC read failure', async () => {
    readPdfBytes
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
    const { result } = renderHook(() => usePdfBytes('C:/workspace/paper.pdf'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(readPdfBytes).toHaveBeenCalledTimes(2);
    if (result.current.status === 'ready') {
      expect([...result.current.bytes]).toEqual([1, 2, 3]);
    }
  });
});
