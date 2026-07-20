/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PdfReaderResponse } from '@/shared/ipc/workspaceApi';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import { usePdfReaderData } from './usePdfReaderData';

describe('usePdfReaderData', () => {
  it('keeps the loaded PDF reader data mounted when annotations update locally', async () => {
    const response: PdfReaderResponse = {
      annotations: [],
      pdf_path: 'C:/workspace/entries/entry-1/paper.pdf',
      segment_notes: [],
      segments: []
    };
    const onReadPdfReader = vi.fn().mockResolvedValue(response);
    const { result, rerender } = renderHook(
      ({ entry }) => usePdfReaderData({ entry, onReadPdfReader }),
      { initialProps: { entry: libraryEntry() } }
    );

    await waitFor(() => expect(result.current.loadState.status).toBe('ready'));

    act(() => {
      result.current.setAnnotations([]);
    });
    rerender({ entry: libraryEntry() });

    expect(onReadPdfReader).toHaveBeenCalledTimes(1);
    expect(result.current.loadState.status).toBe('ready');
  });

  it('refreshes notes and annotations without unloading the PDF reader', async () => {
    const initialResponse: PdfReaderResponse = {
      annotations: [],
      pdf_path: 'C:/workspace/entries/entry-1/paper.pdf',
      segment_notes: [],
      segments: []
    };
    const refreshedResponse: PdfReaderResponse = {
      ...initialResponse,
      segment_notes: [
        {
          created_at: '2026-07-19T00:00:00Z',
          segment_uid: 'segment-1',
          text: 'saved note',
          updated_at: '2026-07-19T00:00:00Z'
        }
      ]
    };
    let resolveRefresh!: (response: PdfReaderResponse) => void;
    const refreshPromise = new Promise<PdfReaderResponse>((resolve) => {
      resolveRefresh = resolve;
    });
    const onReadPdfReader = vi
      .fn()
      .mockResolvedValueOnce(initialResponse)
      .mockReturnValueOnce(refreshPromise);
    const { result, rerender } = renderHook(
      ({ recordReloadKey }) =>
        usePdfReaderData({
          entry: libraryEntry(),
          onReadPdfReader,
          recordReloadKey
        }),
      { initialProps: { recordReloadKey: 0 } }
    );

    await waitFor(() => expect(result.current.loadState.status).toBe('ready'));
    const loadedData = result.current.loadState.status === 'ready'
      ? result.current.loadState.data
      : null;

    rerender({ recordReloadKey: 1 });

    expect(onReadPdfReader).toHaveBeenCalledTimes(2);
    expect(result.current.loadState).toEqual({
      data: loadedData,
      error: null,
      status: 'ready'
    });

    await act(async () => {
      resolveRefresh(refreshedResponse);
      await refreshPromise;
    });

    expect(result.current.segmentNotes).toEqual(refreshedResponse.segment_notes);
    expect(result.current.loadState).toEqual({
      data: loadedData,
      error: null,
      status: 'ready'
    });
  });
});

function libraryEntry(): LibraryEntry {
  return {
    contents: [],
    createdAt: '2026-07-15T00:00:00Z',
    fields: {},
    id: 'entry-1',
    parseEndpoint: null,
    parseMessage: null,
    pdfFileName: 'paper.pdf',
    progress: 100,
    status: 'Parsed',
    tagIds: [],
    tags: [],
    title: 'Entry',
    updatedAt: '2026-07-15T00:00:00Z'
  };
}
