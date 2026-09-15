import type { Editor } from '@tiptap/core';
import { NodeViewWrapper } from '@tiptap/react';
import { ChevronDown, Link2 } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useNoteSourceStatus } from '../NoteSourcesContext';
import type { SourceLinkAttrs, SourceLinkOpenTarget, SourceLinkSnapshotAssetContext } from './SourceLinkNode';
import { SourceLinkPreviewPanel, type SourceLinkPreviewMode } from './SourceLinkPreviewPanel';

// Scope coordination to the mounted editor, never to an anchor ID shared by
// another note or workspace. Viewing a citation must not mutate the document.
const PREVIEW_EVENT = 'neuink:source-preview';
type PreviewEvent = CustomEvent<{ id?: string; collapseAll?: boolean }>;

export function SourceLinkNodeView({ deleteNode, node, editor, getPdfDocument, snapshotAssetContext, onOpenSourceLink }: {
  deleteNode?: () => void;
  node: { attrs: Partial<SourceLinkAttrs> };
  editor?: Editor;
  getPdfDocument?: (() => PDFDocumentProxy | null) | null;
  updateAttributes?: (attrs: Partial<SourceLinkAttrs>) => void;
  snapshotAssetContext?: SourceLinkSnapshotAssetContext | null;
  onOpenSourceLink?: ((target: SourceLinkOpenTarget) => void) | null;
}) {
  const id = useId();
  const wrapperRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [inline, setInline] = useState(false);
  const [editable, setEditable] = useState(editor?.isEditable ?? false);
  const [previewWidth, setPreviewWidth] = useState(420);
  const attrs: SourceLinkAttrs = { ...node.attrs, anchorId: node.attrs.anchorId ?? '' };
  const sourceStatus = useNoteSourceStatus(attrs.anchorId);
  const [selectedMode, setMode] = useState<SourceLinkPreviewMode | null>(null);
  // Source metadata is hydrated after the inline node mounts.
  const mode = sourceStatus && !sourceStatus.can_locate ? 'parsed' : selectedMode ?? defaultMode(attrs);
  const label = attrs.displayText || (attrs.page ? 'p.' + attrs.page : '来源');
  const canOpenSource = (!sourceStatus || sourceStatus.can_locate) && Boolean(onOpenSourceLink && attrs.sourceEntryId && (attrs.segmentUid || (attrs.page && attrs.page > 0)));
  const scope = () => editor?.view.dom ?? wrapperRef.current?.closest('.tiptap') ?? wrapperRef.current?.parentElement;
  const coordinate = (collapseAll = false) => scope()?.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: { id, collapseAll } }));
  const changeOpen = (value: boolean) => {
    if (value) coordinate();
    setOpen(value);
  };
  const close = () => {
    setOpen(false); setInline(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const owner = scope();
    const handlePreview = (event: Event) => {
      const detail = (event as PreviewEvent).detail;
      if (detail.collapseAll) { setOpen(false); setInline(false); }
      else if (detail.id !== id) setOpen(false);
    };
    const handleDrag = () => setOpen(false);
    owner?.addEventListener(PREVIEW_EVENT, handlePreview);
    window.addEventListener('dragstart', handleDrag, true);
    return () => {
      owner?.removeEventListener(PREVIEW_EVENT, handlePreview);
      window.removeEventListener('dragstart', handleDrag, true);
    };
  }, [editor, id]);
  useEffect(() => {
    if (!editor) return;
    const syncEditable = () => setEditable(editor.isEditable);
    syncEditable();
    editor.on('update', syncEditable);
    editor.on('transaction', syncEditable);
    return () => { editor.off('update', syncEditable); editor.off('transaction', syncEditable); };
  }, [editor]);
  useEffect(() => {
    if (!open) return;
    const container = wrapperRef.current?.closest('.markdown-note-scroll, .tiptap') as HTMLElement | null;
    if (!container) return;
    const measure = () => setPreviewWidth(Math.max(180, Math.min(560, container.clientWidth - 16)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [open]);
  const openSource = () => {
    const pane = wrapperRef.current?.closest('[data-workspace-drop-pane]')?.getAttribute('data-workspace-drop-pane');
    if (canOpenSource) onOpenSourceLink?.({
      ...(pane === 'left' || pane === 'right' ? { originPane: pane } : {}),
      page: attrs.page ?? null, segmentUid: attrs.segmentUid ?? null, sourceEntryId: attrs.sourceEntryId ?? null
    });
    else changeOpen(true);
  };
  const panel = () => <SourceLinkPreviewPanel
    attrs={attrs} mode={mode} inline={inline} canOpenSource={canOpenSource} canDelete={editable && Boolean(deleteNode)}
    pdfDocument={getPdfDocument?.() ?? null} snapshotAssetContext={snapshotAssetContext ?? null}
    onModeChange={setMode} onClose={close} onOpenSource={openSource}
    onInline={() => { setOpen(false); setInline(true); }}
    onCollapseAll={() => coordinate(true)}
    onDelete={() => { if (editor?.isEditable && deleteNode) { setOpen(false); setInline(false); deleteNode(); } }}
  />;
  return <NodeViewWrapper as="span" ref={wrapperRef} contentEditable={false} data-source-link="true"
    className={cn('source-link-node max-w-full align-baseline', inline ? 'my-1 block w-full min-w-0' : 'inline-flex')}>
    <Popover open={open && !inline} onOpenChange={changeOpen}>
      <span className="inline-flex max-w-full items-center rounded-sm border border-primary/25 bg-accent text-primary">
        <Button size="xs" variant="ghost" className="h-auto min-w-0 gap-1 rounded-none px-1 py-0.5 text-[0.75em] leading-none"
          title={canOpenSource ? '单击定位原文；右侧箭头预览来源' : '来源信息不完整，单击查看已保存的预览'}
          onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={openSource}>
          <Link2 className="size-3" /><span className="max-w-48 truncate">{label}</span>
          {sourceStatus && sourceStatus.status !== 'available' ? <span className="max-w-48 truncate text-muted-foreground" title={sourceStatus.message}>{sourceStatus.message}</span> : null}
        </Button>
        <PopoverTrigger asChild>
          <Button size="icon-xs" variant="ghost" ref={triggerRef}
            className="h-5 w-5 rounded-none border-l border-primary/20"
            aria-label={inline ? '收起来源预览' : '预览来源：' + label} title={inline ? '收起来源预览' : '预览来源'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => { if (inline) { event.preventDefault(); setInline(false); } }}>
            <ChevronDown className={cn('size-3', (open || inline) && 'rotate-180')} />
          </Button>
        </PopoverTrigger>
      </span>
      <PopoverContent viewportAligned align="start" sideOffset={6}
        className="source-link-popover min-h-0 min-w-0 gap-0 rounded-md p-0 shadow-md"
        style={{ width: previewWidth, maxWidth: 'calc(var(--radix-popover-content-available-width, 100vw) - 16px)', maxHeight: 'var(--radix-popover-content-available-height)' }}
        aria-label="来源预览"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={() => triggerRef.current?.focus({ preventScroll: true })}>
        {panel()}
      </PopoverContent>
    </Popover>
    {inline && panel()}
  </NodeViewWrapper>;
}

function defaultMode(attrs: Partial<SourceLinkAttrs>): SourceLinkPreviewMode {
  if (attrs.previewMode === 'original' || attrs.previewMode === 'parsed') return attrs.previewMode;
  return ['image', 'figure', 'table', 'math', 'equation', 'formula'].includes(attrs.segmentType ?? '') && (attrs.sourceBbox || attrs.snapshotAssetPath) ? 'original' : 'parsed';
}
