import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { importZoteroNotes, listZoteroNoteImports, type SourceNoteCandidate } from '@/shared/ipc/zoteroApi';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

export function ZoteroNoteImportDialog({ root, source, targets, onClose, refreshEntries, beforeSave, onOpenEntry }: {
  root: string; source: LibraryEntry; targets: LibraryEntry[]; onClose: () => void;
  refreshEntries: () => Promise<void>; beforeSave: (id: string) => Promise<void>;
  onOpenEntry?: (id: string) => void;
}) {
  const { notify } = useToast();
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  const [notes, setNotes] = useState<SourceNoteCandidate[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const live = useRef(true), pending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true); setNotes([]); setSelected(new Set()); setError(null);
    void listZoteroNoteImports(root, source.id, target).then(result => {
      if (!cancelled) { setNotes(result.notes); setSelected(new Set(result.notes.filter(note => !note.imported).map(note => note.key))); }
    }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, source.id, target, revision]);
  const submit = async () => {
    if (!target || pending.current || !selected.size || loading) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await beforeSave(target);
      if (!live.current) return;
      const result = await importZoteroNotes(root, source.id, target, notes.filter(note => selected.has(note.key) && !note.imported).map(note => ({ key: note.key, content_hash: note.content_hash })));
      if (!live.current) return;
      try { await refreshEntries(); } catch { notify({ title: '笔记已保存，列表刷新失败', description: '重新打开本地条目即可读取，无需重复导入。' }); }
      if (!live.current) return;
      notify({ tone: 'success', title: `已导入 ${result.imported} 篇 Zotero 笔记`, description: result.skipped ? `另有 ${result.skipped} 篇相同版本已存在。` : '笔记保存在本地条目中，原有笔记和改稿均保留。', action: onOpenEntry ? <Button size="xs" variant="outline" onClick={() => onOpenEntry(result.entry_id)}>打开本地条目</Button> : undefined });
      onClose();
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent layout="bounded" className="max-w-2xl sm:max-w-2xl">
      <DialogHeader><DialogTitle>导入 Zotero 笔记</DialogTitle><DialogDescription>{source.title}。从本地 Zotero 数据目录读取，无需启动 Zotero。来源有新版本时新增一份笔记，保留本地改稿；同一版本不会重复导入。文字与原始 HTML 快照会保留，图片暂需在 Zotero 中查看。</DialogDescription></DialogHeader>
      <div className="space-y-1"><Label>保存到本地条目</Label><Select value={target} disabled={busy} onValueChange={setTarget}><SelectTrigger aria-label="保存到本地条目"><SelectValue placeholder="选择本地条目" /></SelectTrigger><SelectContent>{targets.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent></Select></div>
      <DialogBody className="space-y-2">
        {loading ? <p role="status" className="py-4 text-xs text-muted-foreground">正在读取来源笔记…</p> : !notes.length && !error ? <p className="py-4 text-xs text-muted-foreground">来源论文没有可导入的笔记。</p> : notes.map(note => <div key={note.key} className="border-b border-border py-2 text-xs">
          <Label className="flex items-center gap-2"><Checkbox disabled={busy || note.imported} checked={selected.has(note.key)} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); if (checked === true) next.add(note.key); else next.delete(note.key); return next; })} /><span>{note.title}</span><span className="ml-auto text-muted-foreground">{note.imported ? '本版本已导入' : '可导入'}</span></Label>
          <p className="ml-6 mt-1 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">{note.text || '空笔记'}</p>
          <details className="ml-6 mt-1 text-muted-foreground"><summary className="cursor-pointer">查看完整内容</summary><p className="mt-1 whitespace-pre-wrap break-words">{note.text || '空笔记'}</p></details>
        </div>)}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </DialogBody>
      <DialogFooter><Button variant="ghost" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>重新读取</Button><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button disabled={busy || loading || !target || !selected.size} onClick={() => void submit()}>{busy ? '正在导入…' : `导入所选 ${selected.size} 篇`}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
