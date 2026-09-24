import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { SourceSegment } from '@/shared/types/domain';
import { buildPaperReferenceIndex, matchPaperReferences, type PaperReference } from './paperReferenceIndex';
import { useReadingNavigation } from './ReadingNavigation';
import { readCachedPdfSegmentSnapshot } from '../reflow/pdfSourceSnapshot';

type ReferenceContext = { segments: SourceSegment[]; index: ReturnType<typeof buildPaperReferenceIndex>;
  entryId: string; workspaceRoot: string | null; pdfDocument: PDFDocumentProxy | null; onRequirePdfDocument?: () => void; pdfPreviewError?: string | null; onRetryPdfPreview?: () => void };
const Context = createContext<ReferenceContext | null>(null);
export function PaperReferencesProvider({ segments, entryId, workspaceRoot, pdfDocument, children, onRequirePdfDocument, pdfPreviewError, onRetryPdfPreview }: Omit<ReferenceContext, 'index'> & { children: ReactNode }) {
  const index = useMemo(() => buildPaperReferenceIndex(segments), [segments]);
  const value = useMemo(() => ({ segments, index, entryId, workspaceRoot, pdfDocument, onRequirePdfDocument, pdfPreviewError, onRetryPdfPreview }), [segments, index, entryId, workspaceRoot, pdfDocument, onRequirePdfDocument, pdfPreviewError, onRetryPdfPreview]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePaperReferences() { return useContext(Context); }

export function PaperReferenceLink({ label, targets, placement }: { label: string; targets: PaperReference[]; placement?: CSSProperties }) {
  const context = usePaperReferences();
  const navigation = useReadingNavigation();
  const [open, setOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const jumped = useRef(false);
  if (!context || !navigation) return <>{label}</>;
  const jump = (target: PaperReference) => {
    if (navigation.navigate(target)) { jumped.current = true; setOpen(false); setChooserOpen(false); setError(''); }
    else { setError('目标在当前视图中不可见，请恢复被隐藏的内容后重试。'); setOpen(true); }
  };
  const preview = <>
    {error ? <p role="alert" className="mb-2 text-xs text-destructive">{error}</p> : null}
    {targets.map(target => <div key={`${target.label}:${target.segmentUid}`} className="space-y-2 border-b py-2 first:pt-0 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 text-xs"><span className="mr-auto font-medium">{target.label} · 第 {target.pageIdx + 1} 页</span>
        <Button size="xs" variant="ghost" onClick={() => jump(target)}>定位原文</Button></div>
      <PaperReferencePreview target={target} />
    </div>)}
  </>;
  return <Popover open={chooserOpen} onOpenChange={setChooserOpen}><HoverCard open={open && !chooserOpen} onOpenChange={setOpen}>
    <HoverCardTrigger asChild><PopoverTrigger asChild><button ref={trigger} type="button" data-paper-reference style={placement} className="pointer-events-auto inline cursor-pointer rounded-sm text-primary underline decoration-primary/40 underline-offset-2 hover:bg-primary/10 hover:decoration-primary focus-visible:outline focus-visible:outline-ring"
      aria-label={`${label}，预览或定位原文`} onFocus={() => setOpen(true)}
      onMouseMove={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); if (targets.length === 1) jump(targets[0]); else { jumped.current = false; setOpen(false); setChooserOpen(true); } }}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); jumped.current = false; setOpen(false); setChooserOpen(true); } }}>
      {label}
    </button></PopoverTrigger></HoverCardTrigger>
    <HoverCardContent className="reader-popover w-[26rem]" layer="reader-preview" onClick={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()}>
      {preview}
    </HoverCardContent>
    <PopoverContent viewportAligned className="reader-popover w-[26rem] max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto" onClick={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onCloseAutoFocus={event => {
      event.preventDefault();
      if (!jumped.current) trigger.current?.focus({ preventScroll: true });
      setOpen(false);
    }}>
      {preview}
    </PopoverContent>
  </HoverCard></Popover>;
}

export function PaperReferencePreview({ target }: { target: PaperReference }) {
  const context = usePaperReferences()!;
  const [image, setImage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const needsImage = target.segment.segment_type === 'figure' && !target.segment.asset_path && Boolean(target.segment.bbox);
  useEffect(() => {
    if (!needsImage) return;
    let current = true; setFailed(false); setImage(null);
    if (!context.pdfDocument) {
      if (context.pdfPreviewError || !context.onRequirePdfDocument) setFailed(true);
      else context.onRequirePdfDocument();
      return;
    }
    void readCachedPdfSegmentSnapshot(context.pdfDocument, target.segment).then(url => { if (current) { setImage(url); setFailed(!url); } }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [needsImage, context.pdfDocument, target.segment, context.onRequirePdfDocument, context.pdfPreviewError, attempt]);
  return <>
    {image ? <img src={image} alt={`${target.label} 原文图表`} className="mb-2 h-auto w-full bg-white" />
      : needsImage ? <p className="mb-2 text-xs text-muted-foreground">{failed ? '图表预览暂不可用。' : '正在读取原文图表…'}{failed ? <Button size="xs" variant="ghost" onClick={() => { if (!context.pdfDocument) context.onRetryPdfPreview?.(); setAttempt(n => n + 1); }}>重试</Button> : null}</p> : null}
    <SourceSnapshotPreview compact allowScroll={false} markdown={target.text} relatedImagePath={target.segment.asset_path}
      segmentType={target.segment.segment_type} sourceEntryId={context.entryId} workspaceRoot={context.workspaceRoot} />
  </>;
}

/** Use the shared Markdown renderer; only prose text receives reference controls. */
export function PaperTextPreview(props: ComponentProps<typeof SourceSnapshotPreview>) {
  const index = usePaperReferences()?.index;
  const renderInline = useCallback((children: ReactNode): ReactNode => Children.map(children, child => {
    if (typeof child === 'string') {
      if (!index) return child;
      const matches = matchPaperReferences(child, index);
      if (!matches.length) return child;
      const pieces: ReactNode[] = []; let offset = 0;
      for (const match of matches) {
        if (match.start < offset) continue;
        pieces.push(child.slice(offset, match.start), <PaperReferenceLink key={`${match.start}:${match.label}`} label={match.label} targets={match.targets} />);
        offset = match.end;
      }
      pieces.push(child.slice(offset)); return pieces;
    }
    if (isValidElement<{ children?: ReactNode; className?: string }>(child) && typeof child.type === 'string'
      && !['a', 'code', 'pre', 'button', 'math'].includes(child.type) && !/katex|math/.test(child.props.className ?? '')) {
      return cloneElement(child, {}, renderInline(child.props.children));
    }
    return child;
  }), [index]);
  return <SourceSnapshotPreview {...props} renderInlineText={index ? renderInline : undefined} />;
}
