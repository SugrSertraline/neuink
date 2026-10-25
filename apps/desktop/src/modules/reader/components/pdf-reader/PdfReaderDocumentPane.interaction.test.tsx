// @vitest-environment jsdom
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfReaderDocumentPane } from './PdfReaderDocumentPane';

vi.mock('./PdfSourcePage', () => ({ PdfSourcePage: () => <div>PDF page</div> }));
vi.mock('./useVisiblePdfPages', () => ({ useVisiblePdfPages: () => ({ renderPageIndexes: new Set(), visiblePageIndexes: new Set() }) }));
vi.mock('./usePdfBookNavigation', () => ({ usePdfBookNavigation: () => ({ rowIndex: 0, pageWidth: 400, render: new Set(), visible: new Set() }) }));
vi.mock('./PdfLayoutAnchor', () => ({ PdfLayoutAnchor: ({ children }: { children: ReactNode }) => children }));
afterEach(cleanup);
const noop = () => {};
function Harness({ onZoom, ready = true }: { onZoom: ReturnType<typeof vi.fn>; ready?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const props: ComponentProps<typeof PdfReaderDocumentPane> = {
    entry: { id: 'test', title: 'PDF', contents: [], tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '',
      status: 'Parsed', progress: 100, pdfFileName: 'test.pdf', parseMessage: null, parseEndpoint: null },
    flashSegmentUid: null, hoveredSegmentUid: null, annotationsBySegmentUid: new Map(), notesBySegmentUid: new Map(), pageWidth: 400,
    hoverPreviewEnabled: false, hoverPreviewFontSize: 'standard', hoverPreviewSize: 'standard', hoverPreviewShowRegion: false,
    hoverPreviewShowOriginal: false, hoverPreviewShowNote: false, hoverPreviewShowAnnotation: false, inlineAnnotationHoverEnabled: false,
    hoverPreviewShowTranslation: false, sentenceHoverShowOriginal: false, sentenceHoverShowTranslation: false,
    rows: [], pdfAvailable: true, pdfBytesState: { status: 'ready', bytes: new Uint8Array(), error: null, retry: noop },
    bindPdfScrollElement: element => { ref.current = element; }, pdfScrollRef: ref,
    pdfState: ready ? { status: 'ready', document: {} as PDFDocumentProxy, error: null } : { status: 'loading', document: null, error: null },
    showRegions: false, suppressRegions: false, sourceBacklinksBySegmentUid: {}, translationBySegmentUid: new Map(),
    translationStatus: null, translationMode: 'hover', translationVisible: false, workspaceRoot: null,
    onCtrlWheelZoom: onZoom, onOpenSegmentAnnotation: noop, onOpenSegmentNote: noop, onOpenSourceBacklink: noop,
    onCloseSegmentOverlay: noop, onCreateTextSelectionAnnotation: noop, onToggleSegment: noop,
  };
  return <PdfReaderDocumentPane {...props} />;
}
it('owns Ctrl+wheel without browser zoom or parent scrolling and preserves ordinary wheel scrolling', () => {
  const onZoom = vi.fn(), parentWheel = vi.fn();
  const ui = render(<div onWheel={parentWheel}><Harness onZoom={onZoom} /></div>);
  const viewport = ui.getByLabelText('PDF 阅读区，按住空格拖动');
  expect(fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, clientX: 250, clientY: 100 })).toBe(false);
  expect(onZoom).toHaveBeenCalledWith({ deltaY: -100, deltaMode: 0, timeStamp: expect.any(Number), viewportHeight: viewport.clientHeight });
  expect(parentWheel).not.toHaveBeenCalled();
  expect(fireEvent.wheel(viewport, { deltaY: 100 })).toBe(true);
  expect(parentWheel).toHaveBeenCalledOnce();
  expect(onZoom).toHaveBeenCalledOnce();
});
it('releases wheel and Space ownership when the document becomes unavailable', () => {
  const onZoom = vi.fn();
  const ui = render(<Harness onZoom={onZoom} />);
  const viewport = ui.getByLabelText('PDF 阅读区，按住空格拖动');
  fireEvent.keyDown(viewport, { code: 'Space', key: ' ' });
  expect(viewport.dataset.pdfPan).toBe('ready');
  ui.rerender(<Harness onZoom={onZoom} ready={false} />);
  expect(viewport.dataset.pdfPan).toBeUndefined();
  expect(fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100 })).toBe(true);
  expect(onZoom).not.toHaveBeenCalled();
});
