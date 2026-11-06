import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { CopyPlus, Download, FileDown, FolderOpen, LoaderCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipIconButton } from '@/shared/components/TooltipIconButton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ContextMenuItem } from '@/components/ui/context-menu';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { copySourceToLocal, type LocalCopyResult } from '@/shared/ipc/workspaceApi';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { ZoteroNoteImportDialog } from './ZoteroNoteImportDialog';
import { importZoteroLocalCopy } from '@/shared/ipc/zoteroApi';

type CopyActions = { busyEntryId: string | null; importCopy: (entryId: string, forceNew?: boolean) => void; openEntry: (entryId: string) => void; canImportNotes: (entry: LibraryEntry) => boolean; importNotes: (entry: LibraryEntry) => void };
const SourceLocalCopyContext = createContext<CopyActions | null>(null);

export function SourceLocalCopyProvider({ root, entries = [], refreshEntries, setHidden, beforeCopy, onOpenEntry, children }: {
  entries?: LibraryEntry[];
  root: string | null; refreshEntries: () => Promise<void>; setHidden: (id: string, hidden: boolean) => Promise<void>;
  beforeCopy: (entryId: string) => Promise<void>; onOpenEntry: (id: string) => void; children: ReactNode;
}) {
  const { notify } = useToast();
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ sourceId: string; result: LocalCopyResult } | null>(null);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesSource, setNotesSource] = useState<LibraryEntry | null>(null);
  const pending = useRef(false), hidePending = useRef(false), live = useRef(true);
  // A toast can outlive the render that created the copy, so navigation must see the refreshed entries.
  const openEntry = useRef(onOpenEntry); openEntry.current = onOpenEntry;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const importCopy = async (entryId: string, forceNew = false) => {
    if (!root || pending.current || completed) return;
    pending.current = true; setBusyEntryId(entryId);
    try {
      await beforeCopy(entryId);
      if (!live.current) return;
      const source = entries.find(entry => entry.id === entryId);
      const result = source?.sourceInfo?.kinds.includes('zotero') ? await importZoteroLocalCopy(root, entryId, forceNew) : await copySourceToLocal(root, entryId, forceNew);
      if (!live.current) return;
      try { await refreshEntries(); }
      catch { if (live.current) notify({ tone: 'danger', title: '本地副本已保存，列表刷新失败', description: '重新打开条目库即可读取，不需要重复导入。' }); }
      if (!live.current) return;
      if (!result.created) { notify({ title: '本地已存在对应条目', description: '已打开本地内容。可单独导入 Zotero 笔记，或明确选择另建一份。' }); openEntry.current(result.entry_id); return; }
      setError(null); setCompleted({ sourceId: entryId, result });
      notify({ tone: 'success', title: '已导入为本地独立副本', description: result.used_cached_source ? '已使用 NeuInk 保留的来源副本。新条目独立维护。' : '后续编辑和删除均独立于来源条目。', action: <Button size="xs" variant="outline" onClick={() => openEntry.current(result.entry_id)}>打开本地条目</Button> });
    } catch (caught) {
      if (live.current) notify({ tone: 'danger', title: '导入本地副本失败', description: caught instanceof Error ? caught.message : String(caught) });
    } finally { pending.current = false; if (live.current) setBusyEntryId(null); }
  };
  const hideSource = async () => {
    if (!completed || hidePending.current) return;
    hidePending.current = true; setHiding(true); setError(null);
    try { await setHidden(completed.sourceId, true); if (live.current) setCompleted(null); }
    catch (caught) { if (live.current) setError(`本地副本已保存，隐藏来源失败：${caught instanceof Error ? caught.message : String(caught)}`); }
    finally { hidePending.current = false; if (live.current) setHiding(false); }
  };
  const localTargets = (entry: LibraryEntry) => entries.filter(local => entry.sourceInfo?.local_copy_ids?.includes(local.id) && !local.sourceInfo?.kinds.length);
  return <SourceLocalCopyContext.Provider value={{ busyEntryId, importCopy: (id, force) => { void importCopy(id, force); }, openEntry: onOpenEntry,
    canImportNotes: entry => Boolean(entry.sourceInfo?.kinds.includes('zotero') && localTargets(entry).length), importNotes: setNotesSource }}>
    {children}
    {notesSource && root && <ZoteroNoteImportDialog root={root} source={notesSource} targets={localTargets(notesSource)} beforeSave={beforeCopy} refreshEntries={refreshEntries} onOpenEntry={id => openEntry.current(id)} onClose={() => setNotesSource(null)} />}
    <Dialog open={Boolean(completed)} onOpenChange={open => { if (!open && !hiding) setCompleted(null); }}>
      <DialogContent><DialogHeader><DialogTitle>已导入本地，是否隐藏来源条目？</DialogTitle>
        <DialogDescription>本地独立副本已经完整保存。隐藏只影响来源条目在 NeuInk 中的显示；来源扫描继续进行，也可以从“已隐藏”中恢复。保留显示时，条目库中会同时显示来源条目和本地副本。</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={hiding} onClick={() => setCompleted(null)}>保留来源显示</Button><Button disabled={hiding} onClick={() => void hideSource()}>{hiding ? '正在隐藏…' : '隐藏来源条目'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </SourceLocalCopyContext.Provider>;
}

export function SourceLocalCopyMenuItems({ entry, mode }: { entry: LibraryEntry; mode: 'context' | 'dropdown' }) {
  const actions = useContext(SourceLocalCopyContext);
  if (!actions) return null;
  const Item = mode === 'context' ? ContextMenuItem : DropdownMenuItem;
  const copied = Boolean(entry.sourceInfo?.local_copy_ids?.length);
  const busy = actions.busyEntryId === entry.id;
  const Icon = busy ? LoaderCircle : copied ? FolderOpen : Download;
  return <><Item disabled={Boolean(actions.busyEntryId)} onSelect={() => actions.importCopy(entry.id)}><Icon aria-hidden="true" className={busy ? 'animate-spin' : undefined} />{busy ? '正在导入本地…' : copied ? '打开本地副本' : '导入到本地'}</Item>
    {actions.canImportNotes(entry) && <Item disabled={Boolean(actions.busyEntryId)} onSelect={() => actions.importNotes(entry)}><FileDown aria-hidden="true" />导入 Zotero 笔记</Item>}
    {copied && <Item disabled={Boolean(actions.busyEntryId)} onSelect={() => actions.importCopy(entry.id, true)}><CopyPlus aria-hidden="true" />另建一份本地副本</Item>}</>;
}

export function SourceLocalCopyButtons({ entry, onAction, iconOnly = false }: { entry: LibraryEntry; onAction?: () => void; iconOnly?: boolean }) {
  const actions = useContext(SourceLocalCopyContext);
  if (!actions) return null;
  const copied = Boolean(entry.sourceInfo?.local_copy_ids?.length);
  const disabled = Boolean(actions.busyEntryId);
  const busy = actions.busyEntryId === entry.id;
  return <>
    <SourceCopyButton iconOnly={iconOnly} icon={busy ? LoaderCircle : copied ? FolderOpen : Download} busy={busy}
      label={busy ? '正在导入本地…' : copied ? '打开本地副本' : '导入到本地'} disabled={disabled} onClick={() => { onAction?.(); actions.importCopy(entry.id); }} />
    {copied && <SourceCopyButton iconOnly={iconOnly} icon={CopyPlus} label={iconOnly ? '另建一份本地副本' : '另建一份'} variant="ghost" disabled={disabled} onClick={() => { onAction?.(); actions.importCopy(entry.id, true); }} />}
    {actions.canImportNotes(entry) && <SourceCopyButton iconOnly={iconOnly} icon={FileDown} label="导入 Zotero 笔记" disabled={disabled} onClick={() => { onAction?.(); actions.importNotes(entry); }} />}
  </>;
}

function SourceCopyButton({ iconOnly, icon: Icon, busy, label, ...props }: ComponentProps<typeof Button> & { iconOnly: boolean; icon: LucideIcon; busy?: boolean; label: string }) {
  if (iconOnly) return <TooltipIconButton {...props} label={label} variant="ghost" className="text-muted-foreground hover:text-foreground">
    <Icon aria-hidden="true" className={busy ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'} />
  </TooltipIconButton>;
  return <Button type="button" size="xs" variant="outline" {...props}>{label}</Button>;
}

export function SourceLocalCopyControl({ entry }: { entry: LibraryEntry }) {
  const actions = useContext(SourceLocalCopyContext);
  const info = entry.sourceInfo;
  if (!info || !actions) return null;
  if (info.copied_from && !info.kinds.length) return <div className="space-y-1 text-xs text-muted-foreground">
    <p>本地独立副本 · 复制自 {info.copied_from.source_kinds.map(kind => kind === 'zotero' ? 'Zotero' : 'MinerU').join(' / ')} · {new Date(info.copied_from.copied_at).toLocaleDateString()}</p>
    <Button size="xs" variant="link" className="px-0 text-xs" onClick={() => actions.openEntry(info.copied_from!.source_entry_id)}>查看来源条目</Button>
  </div>;
  if (!info.kinds.length) return null;
  const copied = Boolean(info.local_copy_ids?.length);
  return <div className="min-w-0 space-y-1 text-xs">
    <p className="text-muted-foreground">{copied ? '本地已存在对应条目，独立维护。' : '来源条目可导入为独立的本地条目。'}</p>
    {!entry.pdfFileName && info.source_pdf_hash && copied && <p className="text-muted-foreground">PDF 已在对应本地条目中，可直接打开。</p>}
    <div className="flex flex-wrap gap-1"><SourceLocalCopyButtons entry={entry} /></div>
  </div>;
}
