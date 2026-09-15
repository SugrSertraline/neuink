import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TagNotesList } from '@/modules/notes/components/TagNotesList';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import type { LibraryEntry } from './LibrarySidebar';
import { buildTagPathById, collectDescendantTagIds } from '../utils/tagTree';

type View = 'overview' | 'papers' | 'notes';
export function TagDetailsView({ root, tagId, tags, entries, initialView, onDescription, onOpenNote, onOpenEntry, onReading, onManage, onTrash }: {
  root: string | null; tagId: string; tags: TagMeta[]; entries: LibraryEntry[]; initialView?: View;
  onDescription: (id: string, value: string, expected: string) => Promise<TagMeta>;
  onOpenNote: (target: NoteTarget, title: string) => void; onOpenEntry: (entry: LibraryEntry) => void;
  onReading: () => void; onManage: () => void; onTrash: () => void;
}) {
  const tag = tags.find((item) => item.id === tagId);
  const [view, setView] = useState<View>(initialView ?? 'overview');
  const [descendants, setDescendants] = useState(false);
  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);
  const ids = descendants ? collectDescendantTagIds(tags, tagId) : new Set([tagId]);
  const papers = entries.filter((entry) => entry.tagIds.some((id) => ids.has(id)));
  if (!tag) return <div className="space-y-2 p-4 text-sm"><p>标签已移入回收站或不可用。描述、标签笔记与阅读进度仍保留。</p><Button size="sm" variant="outline" onClick={onTrash}>打开回收站</Button></div>;
  return <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <header className="flex min-w-0 shrink-0 items-center gap-2 border-b px-3 py-2">
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{tag.name}</h2><p className="truncate text-xs text-muted-foreground">{buildTagPathById(tags).get(tagId)}</p></div>
      <Button size="xs" variant="ghost" onClick={onManage}>管理标签</Button><Button size="xs" variant="outline" onClick={onReading}>平行阅读</Button>
    </header>
    <Tabs value={view} onValueChange={(value) => setView(value as View)} className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList className="m-2 shrink-0 self-start"><TabsTrigger value="overview">概览</TabsTrigger><TabsTrigger value="papers">论文</TabsTrigger><TabsTrigger value="notes">笔记</TabsTrigger></TabsList>
      <TabsContent value="overview" forceMount hidden={view !== 'overview'} className={view === 'overview' ? 'm-0 min-h-0 flex-1 overflow-y-auto p-3' : 'hidden'}>
        <TagDescriptionEditor key={`${root}:${tag.id}`} tag={tag} onSave={onDescription} />
      </TabsContent>
      <TabsContent value="papers" className="m-0 min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-3 border-b px-3 py-2 text-xs"><span>{papers.length} 篇论文</span><label className="flex items-center gap-1"><input type="checkbox" checked={descendants} onChange={(event) => setDescendants(event.target.checked)} />包含子标签</label></div>
        {!papers.length ? <p className="p-3 text-sm text-muted-foreground">暂无论文。为条目添加此标签后会显示在这里。</p> : <ul className="divide-y">{papers.map((entry) => <li key={entry.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpenEntry(entry)}>{entry.title}</button></li>)}</ul>}
      </TabsContent>
      <TabsContent value="notes" forceMount hidden={view !== 'notes'} className={view === 'notes' ? 'm-0 flex min-h-0 flex-1 flex-col' : 'hidden'}><TagNotesList tagId={tagId} scope={`tag-details:${tagId}`} onOpen={onOpenNote} /></TabsContent>
    </Tabs>
  </div>;
}

function TagDescriptionEditor({ tag, onSave }: { tag: TagMeta; onSave: (id: string, value: string, expected: string) => Promise<TagMeta> }) {
  const [baseline, setBaseline] = useState(tag.description ?? '');
  const [draft, setDraft] = useState(tag.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ draft, baseline }); latest.current = { draft, baseline };
  const pending = useRef<Promise<boolean> | null>(null);
  const scope = `tag-details:${tag.id}`;
  const dirty = draft !== baseline;
  useEffect(() => { if (!dirty && !pending.current) { setDraft(tag.description ?? ''); setBaseline(tag.description ?? ''); } }, [tag.description]);
  const save = () => {
    if (pending.current) return pending.current;
    const before = latest.current;
    if (before.draft === before.baseline) return Promise.resolve(true);
    setBusy(true); setError(null);
    pending.current = onSave(tag.id, before.draft, before.baseline).then((saved) => {
      setBaseline(saved.description ?? ''); latest.current.baseline = saved.description ?? '';
      return latest.current.draft === saved.description;
    }).catch((caught) => { setError(String(caught)); return false; }).finally(() => { pending.current = null; setBusy(false); });
    return pending.current;
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const off = registerSegmentEditorCloseHandler(scope, 'description', {
      save: () => saveRef.current(), isDirty: () => latest.current.draft !== latest.current.baseline,
      discard: () => { setDraft(latest.current.baseline); latest.current.draft = latest.current.baseline; setError(null); }
    });
    return () => { off(); setSegmentEditorDirty(scope, 'description', false); };
  }, [scope]);
  useEffect(() => setSegmentEditorDirty(scope, 'description', dirty || busy), [scope, dirty, busy]);
  return <div className="max-w-3xl space-y-3"><label className="block text-sm font-medium" htmlFor={`tag-description-${tag.id}`}>描述</label>
    <Textarea id={`tag-description-${tag.id}`} className="min-h-36 resize-y text-sm" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="这组论文讨论什么，以及你想关注的内容。" />
    <div className="flex items-center gap-2"><Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>{busy ? '保存中…' : '保存描述'}</Button><span role="status" className="text-xs text-muted-foreground">{dirty ? '有未保存修改' : '已保存'}</span></div>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>;
}
