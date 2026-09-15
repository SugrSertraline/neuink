import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import type { TagMeta } from '@/shared/types/domain';

export function TagDescriptionField({ tag, scope, disabled = false, onSave, inline = false }: {
  tag: TagMeta; scope: string; disabled?: boolean;
  inline?: boolean;
  onSave: (id: string, value: string, expected: string) => Promise<TagMeta>;
}) {
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState(tag.description ?? '');
  const [draft, setDraft] = useState(tag.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ draft, baseline }); latest.current = { draft, baseline };
  const pending = useRef<Promise<boolean> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const dirty = draft !== baseline;
  useEffect(() => {
    if (!dirty && !pending.current) { setDraft(tag.description ?? ''); setBaseline(tag.description ?? ''); }
  }, [tag.description]);
  useEffect(() => { if (!editing && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus(); } }, [editing]);
  const finishEditing = () => { restoreFocus.current = true; setEditing(false); setError(null); };
  const save = () => {
    if (pending.current) return pending.current;
    const before = latest.current;
    if (before.draft === before.baseline) return Promise.resolve(true);
    if (disabled) return Promise.resolve(false);
    setBusy(true); setError(null);
    pending.current = onSave(tag.id, before.draft, before.baseline).then(saved => {
      const value = saved.description ?? '';
      setBaseline(value); latest.current.baseline = value;
      return latest.current.draft === value;
    }).catch(caught => { setError(String(caught)); return false; }).finally(() => { pending.current = null; setBusy(false); });
    return pending.current;
  };
  const saveRef = useRef(save); saveRef.current = save;
  const discard = () => { setDraft(latest.current.baseline); latest.current.draft = latest.current.baseline; finishEditing(); };
  useEffect(() => {
    const off = registerSegmentEditorCloseHandler(scope, 'tag-description', {
      save: () => saveRef.current(), isDirty: () => Boolean(pending.current) || latest.current.draft !== latest.current.baseline,
      discard
    });
    return () => { off(); setSegmentEditorDirty(scope, 'tag-description', false); };
  }, [scope]);
  useEffect(() => setSegmentEditorDirty(scope, 'tag-description', dirty || busy), [scope, dirty, busy]);
  return <div className={inline ? 'contents' : 'min-w-0'} aria-label="标签描述">
    {!editing || inline ? <button ref={trigger} type="button" aria-label={baseline ? '编辑标签描述' : '添加标签描述'} aria-expanded={editing} disabled={disabled}
      className={cn('group flex min-w-0 max-w-full items-start gap-1.5 rounded-sm py-0.5 text-left text-xs leading-5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none', inline && 'col-start-2 row-start-1')}
      title={baseline || '添加这个标签的研究主题或阅读目标'} onClick={() => { if (editing) editor.current?.querySelector('textarea')?.focus(); else setEditing(true); }}>
      <span className={inline ? 'truncate' : 'line-clamp-2 whitespace-pre-wrap break-words'}>{inline && editing ? '编辑描述' : baseline || (inline ? '添加描述' : '添加描述，记录这个标签的研究主题或阅读目标')}</span>
      <Pencil aria-hidden="true" className="mt-1 size-3 shrink-0" />
    </button> : null}
    {editing ? <div ref={editor} className={cn('max-w-4xl space-y-2 py-1', inline && 'col-span-full col-start-1 row-start-2 mt-1')}>
      <Textarea autoFocus aria-label="标签描述" rows={3} disabled={disabled} className="min-h-20 max-h-40 resize-y bg-card text-sm" value={draft}
        placeholder="这组论文讨论什么，以及你想关注的内容。" onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void save().then(saved => { if (saved) finishEditing(); }); }
          if (event.key === 'Escape' && !dirty && !busy) { event.preventDefault(); event.stopPropagation(); finishEditing(); }
        }} />
      <div className="flex items-center gap-2">
        <Button size="xs" disabled={disabled || busy} onClick={() => void save().then(saved => { if (saved) finishEditing(); })}>{busy ? '保存中…' : '保存描述'}</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={discard}>取消</Button>
        <span role="status" className="text-xs text-muted-foreground">{busy ? '保存中…' : error ? '保存失败，重试' : dirty ? '未保存' : '已保存'}</span>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div> : null}
  </div>;
}
