import { PointerPreview } from '@/components/ui/pointer-preview';
import type { PdfBlockDragItem } from '@/shared/lib/pdfBlockDrag';

export function PdfBlockDragPreview({ item, preview, showSource = true }: {
  item: PdfBlockDragItem | null;
  showSource?: boolean;
  preview: { item: PdfBlockDragItem; x: number; y: number } | null;
}) {
  if (!item) return null;
  const [left, top, right, bottom] = item.bbox;
  return <>
    {showSource && <div aria-hidden="true" data-pdf-block-drag-highlight="true"
      className="pointer-events-none absolute z-[5] rounded-sm bg-primary/15"
      style={{ left: `${left / 10}%`, top: `${top / 10}%`, width: `${(right - left) / 10}%`, height: `${(bottom - top) / 10}%` }} />}
    {preview ? <PointerPreview anchor={{ x: preview.x, top: preview.y, bottom: preview.y }} width={260}>
      <div className="p-2"><div className="text-xs font-medium">拖入聊天框 · 第 {item.segment.page_idx + 1} 页</div>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{item.segment.text || item.segment.markdown}</p>
        <div className="mt-1 text-xs text-muted-foreground">Esc 取消</div></div>
    </PointerPreview> : null}
  </>;
}
