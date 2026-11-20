import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Columns3, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { resolveColumnOrder, useEntryLibraryColumnOrder } from './useEntryLibraryColumnOrder';
import { ENTRY_LIBRARY_COLUMNS, fieldColumnId } from './LibraryPaperTable';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';

type DropHint = { id: EntryLibraryColumnId; after: boolean };

export function LibraryColumnSettingsDialog({ root, fields, visible, pins, onColumnChange, onPinChange }: {
  root?: string | null; fields: readonly string[]; visible: ReadonlySet<EntryLibraryColumnId>; pins: ReadonlySet<'left' | 'right'>;
  onColumnChange: (column: EntryLibraryColumnId, visible: boolean) => void; onPinChange: (edge: 'left' | 'right', pinned: boolean) => void;
}) {
  const columns = [...ENTRY_LIBRARY_COLUMNS.filter(column => column.id !== 'actions'), ...fields.map(name => ({ id: fieldColumnId(name, root), label: name })), ...ENTRY_LIBRARY_COLUMNS.filter(column => column.id === 'actions')];
  const movable = columns.map(column => column.id).filter(id => id !== 'title' && id !== 'actions');
  const { order, move } = useEntryLibraryColumnOrder(root, movable);
  const ordered = resolveColumnOrder(columns, order);
  const middle = ordered.filter(column => column.id !== 'title' && column.id !== 'actions');
  const bodyRef = useRef<HTMLDivElement>(null);
  const cleanupDrag = useRef<() => void>(() => {});
  const moveRef = useRef(move); moveRef.current = move;
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [dragging, setDragging] = useState<EntryLibraryColumnId | null>(null);
  useEffect(() => () => cleanupDrag.current(), []);
  useEffect(() => { cleanupDrag.current(); }, [root]);
  const shift = (id: EntryLibraryColumnId, direction: -1 | 1) => { const index = middle.findIndex(column => column.id === id); const target = middle[index + direction]; if (target) move(id, target.id, direction > 0); };
  const moveToEdge = (id: EntryLibraryColumnId, end: boolean) => { const target = end ? middle[middle.length - 1] : middle[0]; if (target && target.id !== id) move(id, target.id, end); };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: EntryLibraryColumnId) => {
    if (event.button !== 0) return;
    cleanupDrag.current(); event.preventDefault();
    const handle = event.currentTarget, pointerId = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    let x = startX, y = startY, active = false, hint: DropHint | null = null;
    try { handle.setPointerCapture?.(pointerId); } catch { /* Window listeners still track the pointer. */ }
    const hitTest = () => {
      const body = bodyRef.current?.closest<HTMLElement>('[data-slot=dialog-body]');
      if (!body) return null;
      const bounds = body.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
      for (const row of body.querySelectorAll<HTMLElement>('[data-column-order-row]')) {
        const target = row.dataset.columnOrderRow as EntryLibraryColumnId | undefined;
        if (!target || target === id || target === 'title' || target === 'actions') continue;
        const rect = row.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) return { id: target, after: y >= rect.top + rect.height / 2 };
      }
      return null;
    };
    const updateHint = () => { hint = hitTest(); setDropHint(current => current?.id === hint?.id && current?.after === hint?.after ? current : hint); };
    const scrollTimer = window.setInterval(() => {
      const body = bodyRef.current?.closest<HTMLElement>('[data-slot=dialog-body]'); if (!active || !body) return;
      const rect = body.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
      const delta = y < rect.top + 36 ? -20 : y > rect.bottom - 36 ? 20 : 0;
      if (delta) { body.scrollTop += delta; updateHint(); }
    }, 35);
    const stop = () => {
      window.clearInterval(scrollTimer); window.removeEventListener('pointermove', pointerMove); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerCancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', keyDown, true);
      try { if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId); } catch { /* Capture may already have ended. */ }
      cleanupDrag.current = () => {}; setDropHint(null); setDragging(null);
    };
    const cancel = () => stop();
    const keyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    const pointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return; x = e.clientX; y = e.clientY;
      if (!active && Math.hypot(x - startX, y - startY) >= 4) { active = true; setDragging(id); }
      if (active) { e.preventDefault(); updateHint(); }
    };
    const pointerUp = (e: PointerEvent) => { if (e.pointerId !== pointerId) return; x = e.clientX; y = e.clientY; if (active) { const target = hitTest(); if (target) moveRef.current(id, target.id, target.after); } stop(); };
    const pointerCancel = (e: PointerEvent) => { if (e.pointerId === pointerId) cancel(); };
    cleanupDrag.current = stop;
    window.addEventListener('pointermove', pointerMove); window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', pointerCancel); window.addEventListener('blur', cancel); window.addEventListener('keydown', keyDown, true);
  };
  return <Dialog onOpenChange={open => { if (!open) cleanupDrag.current(); }}><DialogTrigger asChild><Button aria-label="表头" title="表头" className="text-xs @max-[900px]/library-toolbar:w-8 @max-[900px]/library-toolbar:px-0" size="default" variant="outline"><Columns3 size={14} aria-hidden="true"/><span className="@max-[900px]/library-toolbar:hidden">表头</span></Button></DialogTrigger>
    <DialogContent layout="bounded" className="max-w-lg"><DialogHeader><DialogTitle>表头设置</DialogTitle><DialogDescription>按住手柄拖动，或使用右侧按钮调整顺序；列表从上到下对应表格从左到右。标题和操作列的位置固定，更改立即生效。</DialogDescription></DialogHeader>
      <DialogBody className="space-y-4"><div ref={bodyRef} className="overflow-hidden rounded-md border border-border">{ordered.map(column => {
        const fixed = column.id === 'title' || column.id === 'actions';
        const index = middle.findIndex(item => item.id === column.id);
        return <div key={column.id} data-column-order-row={column.id} className={cn('flex min-h-10 items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0', dragging === column.id && 'bg-accent/50', dropHint?.id === column.id && (dropHint.after ? 'shadow-[inset_0_-2px_var(--primary)]' : 'shadow-[inset_0_2px_var(--primary)]'))}>
          {fixed ? <span className="size-6 shrink-0" aria-hidden="true" /> : <Button type="button" size="icon-xs" variant="ghost" aria-label={`拖动${column.label}列`} title="按住拖动调整顺序，也可使用方向键" className="shrink-0 cursor-grab touch-none select-none text-muted-foreground active:cursor-grabbing" onPointerDown={event => startDrag(event, column.id)} onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); shift(column.id, event.key === 'ArrowUp' ? -1 : 1); } }}><GripVertical size={14} aria-hidden="true"/></Button>}
          <Checkbox aria-label={`显示${column.label}列`} checked={visible.has(column.id)} onCheckedChange={checked => onColumnChange(column.id, checked === true)}/>
          <span className="min-w-0 flex-1 truncate text-sm" title={column.label}>{column.label}</span>{!visible.has(column.id) && <span className="shrink-0 text-xs text-muted-foreground">已隐藏</span>}
          {fixed ? <span className="w-[108px] shrink-0 text-right text-xs text-muted-foreground">位置固定</span> : <div className="flex shrink-0 gap-1">
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`${column.label}列移到最前`} title="移到最前" disabled={index <= 0} onClick={() => moveToEdge(column.id, false)}><ChevronsUp size={14}/></Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`上移${column.label}列`} title="向左移动" disabled={index <= 0} onClick={() => shift(column.id, -1)}><ArrowUp size={14}/></Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`下移${column.label}列`} title="向右移动" disabled={index === middle.length - 1} onClick={() => shift(column.id, 1)}><ArrowDown size={14}/></Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`${column.label}列移到最后`} title="移到最后" disabled={index === middle.length - 1} onClick={() => moveToEdge(column.id, true)}><ChevronsDown size={14}/></Button>
          </div>}
        </div>;
      })}</div><section className="space-y-2 border-t border-border pt-3"><h3 className="text-sm font-medium">固定列</h3><div className="flex flex-wrap gap-4">{(['left', 'right'] as const).map(edge => <label key={edge} className="flex items-center gap-2 text-sm"><Checkbox aria-label={edge === 'left' ? '固定最左列' : '固定最右列'} checked={pins.has(edge)} onCheckedChange={checked => onPinChange(edge, checked === true)}/>{edge === 'left' ? '固定最左列' : '固定最右列'}</label>)}</div></section></DialogBody>
      <DialogFooter><DialogClose asChild><Button type="button">完成</Button></DialogClose></DialogFooter>
    </DialogContent></Dialog>;
}
