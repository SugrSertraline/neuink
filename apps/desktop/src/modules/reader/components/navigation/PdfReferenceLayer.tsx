import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { SourceSegment } from '@/shared/types/domain';
import { readCachedPdfSegmentSnapshot } from '../reflow/pdfSourceSnapshot';
import { useReadingNavigation, type ReadingTarget } from './ReadingNavigation';
import { PaperReferenceLink, PaperReferencePreview, usePaperReferences } from './PaperReferences';
import { collectPdfTextReferences, readPdfLinkText, type PdfTextReference } from './pdfTextReferences';
import { readNativePdfLinks, type NativePdfLink } from './pdfDestinations';
import { findPdfReferenceFallback, referenceRectsOverlap, resolvePdfReference, type PdfReferenceDestination } from './pdfReferenceFallback';
import { findPdfReferencePreview } from './pdfReferencePreview';

export function PdfReferenceLayer({ document, pageIdx, enabled }: { document: PDFDocumentProxy; pageIdx: number; enabled: boolean }) {
  const [links, setLinks] = useState<NativePdfLink[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const context = usePaperReferences();
  const host = useRef<HTMLDivElement>(null);
  const [textLinks, setTextLinks] = useState<PdfTextReference[]>([]);
  const fallback = useCallback((link: NativePdfLink) => {
    const surface = host.current?.parentElement;
    const textLayer = surface?.querySelector<HTMLElement>('.pdf-text-layer');
    if (!context) return null;
    return findPdfReferenceFallback(link, context.index, textLinks,
      surface && textLayer ? readPdfLinkText(textLayer, surface, link.rect) : '');
  }, [context?.index, textLinks]);
  useEffect(() => {
    const surface = host.current?.parentElement;
    const textLayer = surface?.querySelector<HTMLElement>('.pdf-text-layer');
    if (!enabled || !context || !surface || !textLayer) return;
    let frame = 0;
    const scan = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setTextLinks(collectPdfTextReferences(textLayer, surface, context.index))); };
    const mutation = new MutationObserver(scan); mutation.observe(textLayer, { childList: true, subtree: true, characterData: true });
    const resize = new ResizeObserver(scan); resize.observe(surface); scan();
    return () => { cancelAnimationFrame(frame); mutation.disconnect(); resize.disconnect(); };
  }, [document, pageIdx, enabled, context?.index]);
  useEffect(() => {
    if (!enabled || !context) return;
    let current = true; setFailed(false); setLinks([]);
    void readNativePdfLinks(document, pageIdx).then(links => { if (current) setLinks(links); }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [document, enabled, pageIdx, Boolean(context), attempt]);
  if (!context || !enabled) return null;
  return <div ref={host} className="pointer-events-none absolute inset-0 z-[5]" data-pdf-reference-layer>
    {failed ? <Button size="xs" variant="outline" className="pointer-events-auto absolute right-1 top-1" onClick={() => setAttempt(n => n+1)}>文内链接加载失败，重试</Button> : null}
    {links.map(link => <NativeReference key={link.id} link={link} document={document} fallback={fallback} />)}
    {textLinks.filter(text => !links.some(link => referenceRectsOverlap(text.rect, link.rect)))
      .map((link, i) => <PaperReferenceLink key={`${i}:${link.label}`} label={link.label} targets={link.targets}
        placement={{ position: 'absolute', color: 'transparent', left: `${link.rect[0]*100}%`, top: `${link.rect[1]*100}%`,
          width: `${(link.rect[2]-link.rect[0])*100}%`, height: `${(link.rect[3]-link.rect[1])*100}%`, overflow: 'hidden' }} />)}
  </div>;
}

function NativeReference({ link, document, fallback }: {
  link: NativePdfLink; document: PDFDocumentProxy; fallback: (link: NativePdfLink) => PdfTextReference | null;
}) {
  const [open, setOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [resolved, setResolved] = useState<PdfReferenceDestination | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const jumped = useRef(false);
  const alive = useRef(true);
  const navigation = useReadingNavigation();
  const context = usePaperReferences()!;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if ((!open && !chooserOpen) || resolved) return;
    let current = true; setError('');
    void resolvePdfReference(document, link, () => fallback(link)).then(value => { if (current) setResolved(value); },
      caught => { if (current) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { current = false; };
  }, [document, link, open, chooserOpen, resolved, attempt, fallback]);
  const jump = (target: ReadingTarget) => {
    if (navigation?.navigate(target)) {
      jumped.current = true; setError(''); setOpen(false); setChooserOpen(false);
    } else {
      setError('目标在当前视图中不可见，请恢复被隐藏的内容后重试。'); setOpen(true);
    }
  };
  const activate = async (choose = false) => {
    jumped.current = false; setError('');
    if (choose) { setOpen(false); setChooserOpen(true); } else setOpen(true);
    try {
      const value = resolved ?? await resolvePdfReference(document, link, () => fallback(link));
      if (!alive.current) return;
      setResolved(value);
      if (choose || (value.kind === 'indexed' && value.reference.targets.length > 1)) {
        setOpen(false); setChooserOpen(true);
      } else jump(value.kind === 'native' ? value.target : value.reference.targets[0]);
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const target = resolved?.kind === 'native' ? resolved.target : null;
  const matching = useMemo(() => target ? findPdfReferencePreview(target, fallback(link), context.index, context.segments) : null,
    [target, fallback, link, context.index, context.segments]);
  const preview = <>
    {error ? <div role="alert" className="mb-2 text-xs text-destructive">{error}<Button size="xs" variant="ghost" onClick={() => { setResolved(null); setAttempt(n => n + 1); }}>重试</Button></div> : null}
    {resolved?.kind === 'indexed' ? resolved.reference.targets.map(reference => <div key={`${reference.label}:${reference.segmentUid}`} className="space-y-2 border-b py-2 first:pt-0 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 text-xs"><span className="mr-auto font-medium">{reference.label} · 第 {reference.pageIdx + 1} 页</span>
        <Button size="xs" variant="ghost" onClick={() => jump(reference)}>定位原文</Button></div>
      <PaperReferencePreview target={reference} />
    </div>) : target ? <>
      <div className="mb-2 flex items-center gap-2 text-xs"><span className="mr-auto font-medium">{matching && matching.label !== '文内引用' ? `${matching.label} · ` : ''}第 {target.pageIdx + 1} 页</span>
        <Button size="xs" variant="ghost" onClick={() => jump(target)}>定位原文</Button></div>
      {matching ? <PaperReferencePreview target={matching} />
        : <DestinationImage document={document} target={target} />}
    </> : !error ? <p role="status" className="flex items-center gap-2 text-xs"><Loader2 size={13} className="animate-spin" />正在读取目标…</p> : null}
  </>;
  return <Popover open={chooserOpen} onOpenChange={setChooserOpen}><HoverCard open={open && !chooserOpen} onOpenChange={setOpen}>
    <HoverCardTrigger asChild><PopoverTrigger asChild><button ref={trigger} type="button" data-paper-reference aria-label={`${link.label}，预览或定位原文`}
      className="pointer-events-auto absolute cursor-pointer rounded-sm hover:bg-primary/15 focus-visible:bg-primary/15 focus-visible:outline focus-visible:outline-ring"
      style={{ left: `${link.rect[0]*100}%`, top: `${link.rect[1]*100}%`, width: `${(link.rect[2]-link.rect[0])*100}%`, height: `${(link.rect[3]-link.rect[1])*100}%` }}
      onFocus={() => setOpen(true)} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
      onPointerMove={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onContextMenu={e => e.stopPropagation()}
      onClick={e => { e.preventDefault(); e.stopPropagation(); void activate(); }}
      onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); void activate(true); } }} />
    </PopoverTrigger></HoverCardTrigger>
    <HoverCardContent className="reader-popover w-[26rem]" layer="reader-preview" onClick={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()}>
      {preview}
    </HoverCardContent>
    <PopoverContent viewportAligned className="reader-popover w-[26rem] max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto" onClick={e => e.stopPropagation()} onMouseMove={e => e.stopPropagation()} onCloseAutoFocus={e => {
      e.preventDefault(); if (!jumped.current) trigger.current?.focus({ preventScroll: true }); setOpen(false);
    }}>{preview}</PopoverContent>
  </HoverCard></Popover>;
}

function DestinationImage({ document, target }: { document: PDFDocumentProxy; target: ReadingTarget }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; setImage(null); setError(false);
    const top = Math.max(0, (target.rect?.[1] ?? 0) - 30);
    const segment: SourceSegment = { uid: `pdf-destination:${target.pageIdx}:${top}`, page_idx: target.pageIdx, text: '', markdown: null,
      segment_type: 'paragraph', bbox: [0, top, 1000, Math.min(1000, top + 320)] };
    void readCachedPdfSegmentSnapshot(document, segment).then(value => { if (current) { setImage(value); setError(!value); } }, () => { if (current) setError(true); });
    return () => { current = false; };
  }, [document, target, attempt]);
  return image ? <img src={image} alt={`第 ${target.pageIdx + 1} 页目标位置预览`} className="h-auto w-full bg-white" />
    : error ? <p className="text-xs">预览暂不可用，仍可定位原文。<Button size="xs" variant="ghost" onClick={() => setAttempt(n => n + 1)}>重试预览</Button></p>
    : <p role="status" className="text-xs text-muted-foreground">正在绘制目标位置…</p>;
}
