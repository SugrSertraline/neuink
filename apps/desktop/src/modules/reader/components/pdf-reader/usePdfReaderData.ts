import { useEffect, useState } from 'react';

import type { PdfReaderResponse } from '@/shared/ipc/workspaceApi';
import type { Annotation, SegmentBlockNote } from '@/shared/types/domain';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';

export type PdfReaderLoadState =
  | { status: 'idle' | 'loading'; data: null; error: null }
  | { status: 'ready'; data: PdfReaderResponse; error: null }
  | { status: 'error'; data: null; error: string };

export function usePdfReaderData({
  entry,
  onReadPdfReader,
  reloadKey = 0
}: {
  entry: LibraryEntry;
  onReadPdfReader: (entryId: string) => Promise<PdfReaderResponse>;
  reloadKey?: number;
}) {
  const [loadState, setLoadState] = useState<PdfReaderLoadState>({
    status: 'idle',
    data: null,
    error: null
  });
  const [segmentNotes, setSegmentNotes] = useState<SegmentBlockNote[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  useEffect(() => {
    if (!entry.pdfFileName) {
      setLoadState({ status: 'idle', data: null, error: null });
      setSegmentNotes([]);
      setAnnotations([]);
      return undefined;
    }

    let cancelled = false;
    setLoadState({ status: 'loading', data: null, error: null });

    void onReadPdfReader(entry.id)
      .then((data) => {
        if (!cancelled) {
          setLoadState({ status: 'ready', data, error: null });
          setSegmentNotes(data.segment_notes);
          setAnnotations(data.annotations);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            data: null,
            error: caught instanceof Error ? caught.message : String(caught)
          });
          setSegmentNotes([]);
          setAnnotations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.pdfFileName, onReadPdfReader, reloadKey]);

  return {
    loadState,
    annotations,
    segmentNotes,
    setAnnotations,
    setSegmentNotes
  };
}
