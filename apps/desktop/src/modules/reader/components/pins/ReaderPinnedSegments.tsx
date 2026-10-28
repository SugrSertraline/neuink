import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { useReadingNavigation } from '../navigation/ReadingNavigation';
import { ReaderPinsContext } from './ReaderPinsContext';
import { PinnedSegmentPanel } from './PinnedSegmentPanel';

type Pin = { segment: SourceSegment; offset: number; focusVersion: number };
type Props = { children: ReactNode; entryId: string; workspaceRoot: string | null; pdfDocument: PDFDocumentProxy | null;
  scrollRef: RefObject<HTMLDivElement>; onLocate: (segment: SourceSegment) => boolean };

/** One reading pane owns its pins; switching papers/workspaces cannot leak old content. */
export function ReaderPinnedSegments(props: Props) {
  return <ReaderPinsSession key={JSON.stringify([props.workspaceRoot, props.entryId])} {...props} />;
}

function ReaderPinsSession({ children, entryId, workspaceRoot, pdfDocument, scrollRef, onLocate }: Props) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const navigation = useReadingNavigation();
  const restoreFocus = useRef(false);
  const documentRef = useRef(pdfDocument);
  useLayoutEffect(() => {
    if (documentRef.current !== pdfDocument) { documentRef.current = pdfDocument; setPins([]); }
  }, [pdfDocument]);
  const pin = useCallback((segment: SourceSegment) => {
    setPins(current => {
      const existing = current.find(item => item.segment.uid === segment.uid);
      return [...current.filter(item => item !== existing), existing
        ? { ...existing, focusVersion: existing.focusVersion + 1 }
        : { segment, offset: current.length % 5, focusVersion: 1 }];
    });
  }, []);
  const context = useMemo(() => ({ pin, has: (uid: string) => pins.some(item => item.segment.uid === uid) }), [pin, pins]);
  const activate = (uid: string) => setPins(current => {
    const selected = current.find(item => item.segment.uid === uid);
    return !selected || current[current.length - 1] === selected ? current : [...current.filter(item => item !== selected), selected];
  });
  const close = (uid: string) => {
    restoreFocus.current = Boolean(host?.querySelector(`[data-reader-pin] :focus`));
    setPins(current => current.filter(item => item.segment.uid !== uid));
  };
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    const panels = host?.querySelectorAll<HTMLElement>('[data-reader-pin]');
    const last = panels?.[panels.length - 1];
    (last?.querySelector<HTMLElement>('button') ?? scrollRef.current)?.focus({ preventScroll: true });
  }, [pins, host, scrollRef]);
  const locate = (segment: SourceSegment) => {
    const found = navigation
      ? navigation.navigate({ pageIdx: segment.page_idx, segmentUid: segment.uid, rect: segment.bbox ?? undefined })
      : onLocate(segment);
    if (found) scrollRef.current?.focus({ preventScroll: true });
    return found;
  };
  return <ReaderPinsContext.Provider value={context}>
    <div ref={setHost} className="relative h-full min-h-0 w-full min-w-0" data-reader-pins-host>
      {children}
      {host && pins.length > 0 ? createPortal(
        <div className="pointer-events-none absolute inset-0 z-[var(--z-reader-preview)] overflow-hidden" data-reader-pins-layer>
          {pins.map((item, index) => <PinnedSegmentPanel key={item.segment.uid} host={host} segment={item.segment}
            entryId={entryId} workspaceRoot={workspaceRoot} pdfDocument={pdfDocument} offset={item.offset}
            focusVersion={item.focusVersion} layer={index + 1} onActivate={() => activate(item.segment.uid)}
            onClose={() => close(item.segment.uid)} onLocate={() => locate(item.segment)} />)}
        </div>, host) : null}
    </div>
  </ReaderPinsContext.Provider>;
}
