import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type TableNode = { type?: string; tagName?: string; properties?: Record<string, unknown>; children?: TableNode[] };

export function sourceTableDimensions(node?: TableNode) {
  let rows = 0;
  let columns = 0;
  // Track occupied columns so row spans do not undercount irregular tables.
  const spans: number[] = [];
  const visit = (current: TableNode) => {
    if (current.tagName === 'tr') {
      rows += 1;
      let column = 0;
      for (const cell of current.children ?? []) {
        if (cell.tagName !== 'th' && cell.tagName !== 'td') continue;
        while ((spans[column] ?? 0) > 0) column += 1;
        const width = Math.max(1, Number(cell.properties?.colSpan) || 1);
        const height = Math.max(1, Number(cell.properties?.rowSpan) || 1);
        for (let offset = 0; offset < width; offset += 1) spans[column + offset] = height;
        column += width;
      }
      columns = Math.max(columns, column, spans.length);
      for (let index = 0; index < spans.length; index += 1) spans[index] = Math.max(0, spans[index] - 1);
      return;
    }
    for (const child of current.children ?? []) {
      if (child.tagName !== 'table') visit(child);
    }
  };
  if (node) visit(node);
  return { rows, columns: Math.max(1, columns) };
}

export function SourceSnapshotTable({ children, node, allowScroll, detailEnabled, compact, flush }: {
  children: ReactNode;
  node?: TableNode;
  allowScroll: boolean;
  detailEnabled: boolean;
  compact: boolean;
  flush: boolean;
}) {
  const { rows, columns } = sourceTableDimensions(node);
  const table = <table className={cn('source-preview-table w-full table-auto border-separate border-spacing-0 text-left', compact || flush ? 'text-inherit' : 'text-[0.8em]')}
    style={{ minWidth: columns * 88, maxWidth: 'none' }}>{children}</table>;
  const scroller = (detail = false) => <div
    className={cn('source-table-scroll min-h-0 min-w-0 max-w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      allowScroll ? 'overflow-auto overscroll-contain' : 'overflow-visible',
      detail ? 'h-full' : detailEnabled && 'max-h-[min(32vh,18rem)]')}
    role="region" aria-label={detail ? '完整表格' : '表格内容'} tabIndex={allowScroll ? 0 : undefined}>{table}</div>;
  if (!detailEnabled) return <div className="source-snapshot-table my-1 min-w-0 max-w-full rounded-sm border">{scroller()}</div>;
  return <Dialog>
    <div className="source-snapshot-table my-2 min-w-0 max-w-full overflow-hidden rounded-sm border bg-card">
      <div className="flex min-w-0 items-center justify-between gap-1 border-b bg-muted px-2 py-1 text-[11px]">
        <span title="行数包含表头">{rows} 行 · {columns} 列</span>
        <DialogTrigger asChild><Button size="xs" variant="ghost">查看大表</Button></DialogTrigger>
      </div>
      {scroller()}
      <div className="border-t px-2 py-1 text-[11px] text-muted-foreground">宽表可横向滚动；长表可在表内上下滚动</div>
    </div>
    <DialogContent showCloseButton={false}
      className="source-preview-detail grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-2"
      onClick={(event) => event.stopPropagation()}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1"><DialogTitle>表格详情</DialogTitle><DialogDescription>{rows} 行 · {columns} 列，完整显示，无行数截断。</DialogDescription></div>
        <DialogClose asChild><Button size="xs" variant="outline">关闭大表</Button></DialogClose>
      </div>
      <div className="source-snapshot-table min-h-0 min-w-0 overflow-hidden rounded-sm border">{scroller(true)}</div>
    </DialogContent>
  </Dialog>;
}
