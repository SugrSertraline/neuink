// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePdfDocument } from './usePdfDocument';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), createWorker: vi.fn(), ports: [] as { terminate: ReturnType<typeof vi.fn> }[] }));
vi.mock('pdfjs-dist', () => ({ getDocument: mocks.getDocument, PDFWorker: { create: mocks.createWorker } }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker', () => ({ default: class {
  terminate = vi.fn();
  constructor() { mocks.ports.push(this); }
} }));
beforeEach(() => { vi.clearAllMocks(); mocks.ports.length = 0; vi.stubGlobal('Worker', class {}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('owns independent workers and byte copies while an old reader is still destroying', async () => {
  let finish!: () => void;
  const oldDestroy = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const workers = [{ destroy: vi.fn() }, { destroy: vi.fn() }];
  mocks.createWorker.mockReturnValueOnce(workers[0]).mockReturnValueOnce(workers[1]);
  mocks.getDocument.mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1 }), destroy: oldDestroy })
    .mockReturnValueOnce({ promise: Promise.resolve({ numPages: 2 }), destroy: vi.fn().mockResolvedValue(undefined) });
  const bytes = new Uint8Array([1, 2, 3]);
  const old = renderHook(() => usePdfDocument(bytes));
  await waitFor(() => expect(old.result.current.status).toBe('ready'));
  old.unmount();
  const next = renderHook(() => usePdfDocument(bytes));
  await waitFor(() => expect(next.result.current.status).toBe('ready'));
  expect(mocks.ports).toHaveLength(2);
  expect(mocks.getDocument.mock.calls[0][0].data).not.toBe(bytes);
  expect(mocks.getDocument.mock.calls[1][0].worker).toBe(workers[1]);
  expect(mocks.ports[1].terminate).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(workers[0].destroy).toHaveBeenCalledOnce();
  expect(mocks.ports[0].terminate).toHaveBeenCalledOnce();
  expect(mocks.ports[1].terminate).not.toHaveBeenCalled();
});

it('turns synchronous worker failures into a recoverable reader error and releases the port', async () => {
  mocks.createWorker.mockImplementation(() => { throw new Error('worker unavailable'); });
  const bytes = new Uint8Array([1]);
  const { result } = renderHook(() => usePdfDocument(bytes));
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.error).toBe('worker unavailable');
  await waitFor(() => expect(mocks.ports[0].terminate).toHaveBeenCalledOnce());
});
