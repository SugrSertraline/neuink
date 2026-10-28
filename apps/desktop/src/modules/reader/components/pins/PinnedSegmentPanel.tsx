import { GripVertical, LocateFixed, MoveDiagonal2, PinOff } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import type { SourceSegment } from '@/shared/types/domain';
import { segmentTypeLabel } from '../pdf-reader/readerUtils';
import { PinnedSegmentContent } from './PinnedSegmentContent';
import { usePinnedSegmentFrame } from './usePinnedSegmentFrame';

export const PinnedSegmentPanel = memo(function PinnedSegmentPanel({ host, segment, entryId, workspaceRoot,
  pdfDocument, offset, layer, focusVersion, onActivate, onClose, onLocate }: {
  host: HTMLElement; segment: SourceSegment; entryId: string; workspaceRoot: string | null;
  pdfDocument: PDFDocumentProxy | null; offset: number; layer: number; focusVersion: number;
  onActivate: () => void; onClose: () => void; onLocate: () => boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const { frame, move, resize } = usePinnedSegmentFrame(host, panel, segment.uid, offset);
  const [locateError, setLocateError] = useState(false);
  const label = `${segmentTypeLabel(segment.segment_type)} · 第 ${segment.page_idx + 1} 页`;
  useLayoutEffect(() => { handle.current?.focus({ preventScroll: true }); }, [focusVersion]);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  return <section ref={panel} role="region" aria-label={`固钉：${label}`} data-reader-pin={segment.uid}
    className="pointer-events-auto absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
    style={{ ...frame, zIndex: layer, visibility: frame ? 'visible' : 'hidden' }}
    onPointerDownCapture={onActivate} onFocusCapture={onActivate}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}>
    <div className="flex shrink-0 items-center gap-0.5 border-b bg-muted/50 px-1 py-0.5">
      <Button ref={handle} size="sm" variant="ghost" className="min-w-0 flex-1 cursor-grab justify-start gap-1 px-1 text-xs touch-none active:cursor-grabbing"
        aria-label={`移动固钉：${label}`} title="拖动移动；方向键微调，Shift 加速" {...move}>
        <GripVertical size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">固钉 · {label}</span>
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="回到原文" title="回到原文"
        onClick={() => setLocateError(!onLocate())}><LocateFixed size={14} aria-hidden="true" /></Button>
      <Button size="icon-xs" variant="ghost" aria-label="取消固定" title="取消固定" onClick={onClose}>
        <PinOff size={14} aria-hidden="true" />
      </Button>
    </div>
    {locateError ? <p role="alert" className="px-2 pt-1 text-xs text-destructive">原文暂时不可见，请恢复阅读页面后重试。</p> : null}
    <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-2 text-sm leading-relaxed" tabIndex={0} aria-label="固钉内容">
      <PinnedSegmentContent segment={segment} entryId={entryId} workspaceRoot={workspaceRoot} pdfDocument={pdfDocument} />
    </div>
    <Button size="icon-xs" variant="ghost" className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-none bg-popover touch-none"
      aria-label="调整固钉大小" title="拖动调整大小；方向键微调，Shift 加速" {...resize}>
      <MoveDiagonal2 size={12} aria-hidden="true" />
    </Button>
  </section>;
});
