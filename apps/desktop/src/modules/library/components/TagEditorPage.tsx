import { FolderPlus, LocateFixed, Maximize, Minus, Plus, Tags, ZoomIn, ZoomOut } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { TagMeta } from '@/shared/types/domain';
import { layoutTagEditorTree, TAG_NODE_HEIGHT } from '../utils/tagEditorLayout';
import { buildTagTree, flattenTagTree, type TagCountEntry, type TagNode } from '../utils/tagTree';
import { DeleteTagDialog } from './DeleteTagDialog';
import { TagEditorNode } from './TagEditorNode';
import { useTagEditorViewport } from './useTagEditorViewport';

type TagEditorPageProps = {
  onOpenTrash?: () => void;
  workspaceRoot?: string | null;
  onRestoreTagArchive?: (archiveId: string) => Promise<number>;
  activeTag: string | null;
  entries: TagCountEntry[];
  tags: TagMeta[];
  onCreateTagPath: (path: string) => Promise<void> | void;
  onDeleteTag: (tagId: string) => Promise<void> | void;
  onRenameTag: (tagId: string, name: string) => Promise<void> | void;
  onSelectTag: (tag: string | null) => void;
};

export function TagEditorPage({ onOpenTrash, activeTag, entries, tags, onCreateTagPath, onDeleteTag, onRenameTag, onSelectTag,
  standalone = false }: TagEditorPageProps & { standalone?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TagNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState<'rename' | 'create' | null>(null);
  const [draft, setDraft] = useState('');
  const [newTagPath, setNewTagPath] = useState('');
  const [error, setError] = useState('');
  const newTagInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const focusCreateAfterMenu = useRef(false);
  const roots = useMemo(() => buildTagTree(tags, entries), [tags, entries]);
  const allNodes = useMemo(() => flattenTagTree(roots), [roots]);
  const layout = useMemo(() => layoutTagEditorTree(roots, collapsedIds), [roots, collapsedIds]);
  const pan = useTagEditorViewport(layout);
  const visibleIds = new Set(layout.nodes.map(item => item.node.id));
  const selected = allNodes.find(node => node.id === selectedId && visibleIds.has(node.id))
    ?? allNodes.find(node => node.id === activeTag && visibleIds.has(node.id)) ?? roots[0] ?? null;
  const branchIds = allNodes.filter(node => node.children.length).map(node => node.id);
  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () => { setCollapsedIds(new Set(branchIds)); setSelectedId(null); setMode(null); };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const createPath = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newTagPath.trim()) return;
    void run(async () => { await onCreateTagPath(newTagPath.trim()); setNewTagPath(''); });
  };
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !draft.trim() || !mode) return;
    void run(async () => {
      if (mode === 'rename') await onRenameTag(selected.id, draft.trim());
      else await onCreateTagPath(`${selected.path}/${draft.trim()}`);
      setMode(null); setDraft('');
      if (mode === 'create') setCollapsedIds(previous => { const next = new Set(previous); next.delete(selected.id); return next; });
    });
  };
  const toggle = (node: TagNode) => {
    setCollapsedIds(previous => { const next = new Set(previous); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
    if (!collapsedIds.has(node.id) && selected?.path.startsWith(`${node.path}/`)) { setSelectedId(node.id); setMode(null); }
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    void run(async () => {
      await onDeleteTag(deleteTarget.id);
      setSelectedId(deleteTarget.parentId); setMode(null); setDeleteTarget(null);
    });
  };
  const beginEdit = (node: TagNode, nextMode: 'rename' | 'create') => {
    setSelectedId(node.id); setMode(nextMode); setDraft(nextMode === 'rename' ? node.name : ''); setError('');
  };

  const content = <div className="@container/tag-editor flex h-full min-h-0 flex-col bg-background">
    <header className="shrink-0 border-b border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tags size={17} className="text-primary" aria-hidden="true" /><h1 className="text-base font-semibold">标签管理</h1>
        <span className="mr-auto text-xs tabular-nums text-muted-foreground">{allNodes.length} 个标签</span>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="树图缩放">
          <Button size="icon-sm" variant="outline" aria-label="缩小树图" title="缩小树图（−）" disabled={!roots.length || !pan.canZoomOut} onClick={pan.zoomOut}><ZoomOut size={14} aria-hidden="true" /></Button>
          <Button size="sm" variant="ghost" className="w-14 px-1 text-xs tabular-nums" aria-label="恢复 100%" title="恢复 100%（0）" disabled={!roots.length} onClick={pan.resetZoom}>{Math.round(pan.zoom * 100)}%</Button>
          <Button size="icon-sm" variant="outline" aria-label="放大树图" title="放大树图（+）" disabled={!roots.length || !pan.canZoomIn} onClick={pan.zoomIn}><ZoomIn size={14} aria-hidden="true" /></Button>
        </div>
        <Button size="sm" variant="ghost" disabled={!roots.length} onClick={pan.fitView}><Maximize size={14} aria-hidden="true" />适应画布</Button>
        <Button size="sm" variant="ghost" disabled={!roots.length} onClick={pan.resetView}><LocateFixed size={14} aria-hidden="true" />视图居中</Button>
        <Button size="sm" variant="ghost" disabled={busy || !collapsedIds.size} onClick={expandAll}>展开全部</Button>
        <Button size="sm" variant="ghost" disabled={busy || !branchIds.length} onClick={collapseAll}><Minus size={14} aria-hidden="true" />收起全部</Button>
        {onOpenTrash && <Button size="sm" variant="outline" onClick={onOpenTrash}>回收站</Button>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">单击选择，双击打开；右键标签或空白处查看操作。拖动空白处平移，Ctrl＋滚轮缩放；聚焦画布后可按 +／− 缩放、0 恢复。</p>
      <form className="mt-3 flex max-w-xl items-center gap-2" onSubmit={createPath}>
        <Input ref={newTagInputRef} aria-label="新标签路径" disabled={busy} placeholder="新建标签，例如：研究/计算机视觉/检测" value={newTagPath} onChange={event => setNewTagPath(event.target.value)} />
        <Button type="submit" size="sm" disabled={busy || !newTagPath.trim()}><Plus size={14} aria-hidden="true" />新建</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem] @max-[720px]/tag-editor:grid-cols-1 @max-[720px]/tag-editor:grid-rows-[minmax(12rem,1fr)_auto]">
      <ContextMenu><ContextMenuTrigger asChild><div role="region" aria-label="标签树图" tabIndex={0} ref={pan.viewportRef} data-allow-context-menu="true"
        className={cn('min-h-0 min-w-0 overflow-auto overscroll-contain bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring cursor-grab', pan.dragging && 'cursor-grabbing select-none')}
        onPointerDown={pan.onPointerDown} onPointerMove={pan.onPointerMove} onPointerUp={pan.onPointerUp}
        onPointerCancel={pan.onPointerCancel} onLostPointerCapture={pan.onLostPointerCapture} onKeyDown={pan.onKeyDown} onContextMenu={pan.cancelPan}>
        <div className="flex min-h-full min-w-full">
        {roots.length ? <div ref={pan.stageRef} data-tag-editor-stage className="relative m-auto shrink-0" style={{ width: layout.width * pan.zoom, height: layout.height * pan.zoom }}>
          <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${pan.zoom})` }}>
          <svg className="pointer-events-none absolute inset-0 text-border" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.links.map(link => <path key={`${link.from}:${link.to}`} d={link.path} fill="none" stroke="currentColor" strokeWidth="1.5" />)}
          </svg>
          {layout.nodes.map(({ node, x, y, expanded }) => <div key={node.id} className="absolute" style={{ left: x, top: y - TAG_NODE_HEIGHT / 2 }}>
            <TagEditorNode node={node} active={activeTag === node.id} selected={selected?.id === node.id} expanded={expanded} busy={busy}
              onToggle={() => toggle(node)} onSelect={() => { if (!busy) { setSelectedId(node.id); setMode(null); setError(''); } }} onOpen={() => onSelectTag(node.id)}
              onCreateChild={() => beginEdit(node, 'create')} onRename={() => beginEdit(node, 'rename')}
              onFocusEditor={() => editInputRef.current?.focus()}
              onDelete={() => { setSelectedId(node.id); setMode(null); setDeleteTarget(node); }} />
          </div>)}
          </div>
        </div> : <p className="m-auto p-6 text-sm text-muted-foreground">暂无标签。可在上方新建一个标签或标签路径。</p>}
        </div>
      </div></ContextMenuTrigger>
        <ContextMenuContent viewportAligned className="w-52" data-allow-context-menu="true" onPointerDown={event => event.stopPropagation()}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (focusCreateAfterMenu.current) { focusCreateAfterMenu.current = false; newTagInputRef.current?.focus(); }
            else pan.viewportRef.current?.focus({ preventScroll: true });
          }}>
          <ContextMenuItem disabled={busy} onSelect={() => { focusCreateAfterMenu.current = true; }}><Plus aria-hidden="true" />新建标签</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!roots.length || !pan.canZoomIn} onSelect={pan.zoomIn}><ZoomIn aria-hidden="true" />放大树图</ContextMenuItem>
          <ContextMenuItem disabled={!roots.length || !pan.canZoomOut} onSelect={pan.zoomOut}><ZoomOut aria-hidden="true" />缩小树图</ContextMenuItem>
          <ContextMenuItem disabled={!roots.length} onSelect={pan.resetZoom}>恢复 100%</ContextMenuItem>
          <ContextMenuItem disabled={!roots.length} onSelect={pan.fitView}><Maximize aria-hidden="true" />适应画布</ContextMenuItem>
          <ContextMenuItem disabled={!roots.length} onSelect={pan.resetView}><LocateFixed aria-hidden="true" />视图居中</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={busy || !collapsedIds.size} onSelect={expandAll}>展开全部</ContextMenuItem>
          <ContextMenuItem disabled={busy || !branchIds.length} onSelect={collapseAll}>收起全部</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <aside aria-label="标签编辑" className="min-h-0 overflow-y-auto border-l border-border bg-card p-4 @max-[720px]/tag-editor:max-h-60 @max-[720px]/tag-editor:border-l-0 @max-[720px]/tag-editor:border-t">
        {selected ? <>
          <p className="text-xs text-muted-foreground">当前标签</p>
          <h2 className="mt-1 break-words text-sm font-semibold">{selected.name}</h2>
          <p className="mt-1 break-all text-xs text-muted-foreground">{selected.path}</p>
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">{selected.children.length} 个直接子标签 · {selected.count} 个条目</p>
          {mode ? <form className="mt-4 space-y-2 border-t border-border pt-3" onSubmit={submitEdit}>
            <label htmlFor="tag-editor-draft" className="text-xs font-medium">{mode === 'rename' ? '重命名标签' : `添加到“${selected.name}”下`}</label>
            <Input ref={editInputRef} id="tag-editor-draft" autoFocus disabled={busy} value={draft} onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMode(null); } }} />
            <div className="flex gap-2"><Button size="sm" type="submit" disabled={busy || !draft.trim()}>保存</Button>
              <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => setMode(null)}>取消</Button></div>
          </form> : <div className="mt-4 space-y-1 border-t border-border pt-3">
            <Button className="w-full justify-start" size="sm" variant="ghost" onClick={() => onSelectTag(selected.id)}>打开条目</Button>
            <Button className="w-full justify-start" size="sm" variant="ghost" disabled={busy} onClick={() => beginEdit(selected, 'create')}><FolderPlus size={14} aria-hidden="true" />添加子标签</Button>
            <Button className="w-full justify-start" size="sm" variant="ghost" disabled={busy} onClick={() => beginEdit(selected, 'rename')}>重命名</Button>
            <Button className="w-full justify-start text-destructive" size="sm" variant="ghost" disabled={busy} onClick={() => setDeleteTarget(selected)}>移入回收站</Button>
          </div>}
        </> : <p className="text-xs text-muted-foreground">选择一个标签后可编辑名称或添加子标签。</p>}
      </aside>
    </div>
    <DeleteTagDialog busy={busy} target={deleteTarget} onConfirm={confirmDelete} onOpenChange={open => { if (!open) setDeleteTarget(null); }} />
  </div>;
  return standalone ? content : <TabsContent className="m-0 h-full min-h-0" value="tag-editor">{content}</TabsContent>;
}
