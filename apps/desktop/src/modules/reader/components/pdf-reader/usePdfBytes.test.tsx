/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readPdfBytes = vi.hoisted(() => vi.fn());

vi.mock('@/shared/ipc/workspaceApi', () => ({ readPdfBytes }));

import { usePdfBytes } from './usePdfBytes';

beforeEach(() => vi.clearAllMocks());
describe('usePdfBytes', () => {

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

 it('shares an in-flight read between simultaneous surfaces and releases it afterwards', async () => {
   let resolve!: (bytes: ArrayBuffer) => void;
   readPdfBytes.mockImplementationOnce(() => new Promise<ArrayBuffer>(done => { resolve = done; }));
   const first = renderHook(() => usePdfBytes('shared.pdf', 'v1'));
   const second = renderHook(() => usePdfBytes('shared.pdf', 'v1'));
   expect(readPdfBytes).toHaveBeenCalledTimes(1);
   await act(async () => resolve(new Uint8Array([7]).buffer));
   expect(first.result.current.status).toBe('ready');
   expect(second.result.current.status).toBe('ready');
   readPdfBytes.mockResolvedValueOnce(new Uint8Array([8]).buffer);
   const third = renderHook(() => usePdfBytes('shared.pdf', 'v1'));
   await waitFor(() => expect(third.result.current.status).toBe('ready'));
   expect(readPdfBytes).toHaveBeenCalledTimes(2);
 });
