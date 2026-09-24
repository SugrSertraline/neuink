import { useEffect, useMemo, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { annotationPaperProps } from '@/modules/annotations/annotationPaper';
import { annotationImportanceLabel } from '@/modules/annotations/annotationRegistry';
import type { Annotation, SourceSegment } from '@/shared/types/domain';
import { annotationPageAnchorSegment } from './pdfPageAnnotations';
import type { PageSegments } from './types';

export function PdfAnnotationTabs({ page, annotations, onOpen, visible }: {
  page: PageSegments; annotations: Map<string, Annotation[]>; onOpen: (segment: SourceSegment, annotationId?: string) => void; visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const notes = useMemo(() => annotationsForPage(page, annotations), [annotations, page]);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  if (!notes.length) return null;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button className="pdf-annotation-tab" size="xs" variant="outline" aria-label={`第 ${page.pageIdx + 1} 页的 ${notes.length} 条批注`}
        title="查看本页批注与高亮" data-paper-color={notes[0].annotation.text_selection?.color ?? 'yellow'}>
        <StickyNote size={12} aria-hidden="true" />批注 {notes.length}
      </Button>
    </PopoverTrigger>
    <PopoverContent viewportAligned align="end" className="w-80 max-w-[calc(100vw-2rem)] p-3">
      <div className="mb-3 text-xs font-medium">第 {page.pageIdx + 1} 页 · 批注与高亮</div>
      <div className="grid max-h-80 gap-3 overflow-auto p-1">
        {notes.map(({ annotation, segment }) => <button key={annotation.annotation_id} type="button"
          {...annotationPaperProps(annotation)} className="grid w-full gap-2 rounded border bg-card p-3 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => { setOpen(false); onOpen(segment, annotation.annotation_id); }}>
          <span className="flex items-center justify-between gap-2 text-muted-foreground"><span>{annotation.content.trim() ? '批注' : '高亮'}</span><span>{annotationImportanceLabel(annotation.importance)}</span></span>
          {annotation.content.trim() ? <span className="line-clamp-5 whitespace-pre-wrap break-words leading-5">{annotation.content}</span> : null}
          {annotation.text_selection?.text ? <q className="line-clamp-3 border-l-2 pl-2 leading-5 text-muted-foreground">{annotation.text_selection.text}</q> : null}
          <span className="text-muted-foreground">打开批注详情</span>
        </button>)}
      </div>
    </PopoverContent>
  </Popover>;
}

export function annotationsForPage(page: PageSegments, annotations: Map<string, Annotation[]>) {
  const seen = new Set<string>();
  const results: { annotation: Annotation; segment: SourceSegment }[] = [];
  const segments = new Map([...page.segments, ...page.regions.map(region => region.sourceSegment)].map(segment => [segment.uid, segment]));
  for (const group of annotations.values()) for (const annotation of group) {
    if (seen.has(annotation.annotation_id)) continue;
    seen.add(annotation.annotation_id);
    const segment = segments.get(annotation.segment_uid) ?? annotationPageAnchorSegment(annotation);
    const pageIdx = annotation.text_selection?.page_idx ?? segment?.page_idx ?? annotation.segment_snapshot?.page_idx;
    if (pageIdx !== page.pageIdx || !segment) continue;
    results.push({ annotation, segment });
  }
  return results;
}
