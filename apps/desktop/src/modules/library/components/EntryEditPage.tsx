import { ArrowLeft, Loader2, Save, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSurfaceCloseGuard } from '@/app/useSurfaceCloseGuard';
import { useToast } from '@/shared/hooks/useToast';
import type { TagMeta } from '@/shared/types/domain';
import { EntryContentHeader } from '@/modules/reader/components/EntryContentHeader';
import { ReaderSurfaceBody } from '@/modules/reader/components/ReaderSurfacePrimitives';
import { ReaderSurfaceFrame } from '@/modules/reader/components/ReaderSurfaceFrame';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { EntryFieldsEditor, fieldsFromRecord, fieldsToRecord } from './EntryFieldsEditor';
import { TagQuickPicker } from './TagQuickPicker';
import { parseTagInput } from '../utils/tagSelection';
import type { LibraryEntry } from './LibrarySidebar';

export type EntryUpdate = { fields: Record<string, string>; tagPaths: string[]; title: string };
function draftFrom(entry: LibraryEntry) {
  return { title: entry.title, description: entry.fields.description ?? entry.fields['描述'] ?? '',
    fields: fieldsFromRecord(entry.fields).filter(field => field.key !== '描述'), tagInput: entry.tags.join(', ') };
}
type Draft = ReturnType<typeof draftFrom>;
function requestFrom(draft: Draft): EntryUpdate {
  return { title: draft.title.trim(), tagPaths: parseTagInput(draft.tagInput),
    fields: { ...Object.fromEntries(Object.entries(fieldsToRecord(draft.fields)).filter(([key]) => key !== '描述')),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}) } };
}
const fingerprint = (entry: LibraryEntry) => JSON.stringify([entry.title, [...entry.tags].sort(), Object.entries(entry.fields).sort(([a], [b]) => a.localeCompare(b))]);

/** The overview surface owns this draft; the body is its only scroll container. */
export function EntryEditPage({ entry, tags, workspaceRoot, scopeKey, onUpdateEntry, onBack }: {
  entry: LibraryEntry; tags: TagMeta[]; workspaceRoot: string | null; scopeKey: string;
  onUpdateEntry: (entryId: string, request: EntryUpdate) => Promise<unknown> | unknown; onBack: () => void;
}) {
  const { notify } = useToast();
  const id = useId(), owner = `entry-metadata:${id}`;
  const [draft, setDraft] = useState(() => draftFrom(entry));
  const [baseline, setBaseline] = useState(() => draftFrom(entry));
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const baseVersion = useRef(fingerprint(entry));
  const live = useRef(true), pending = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ entry, draft, baseline }); latest.current = { entry, draft, baseline };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const selectedPaths = parseTagInput(draft.tagInput);
  const update = (patch: Partial<Draft>) => {
    const next = { ...latest.current.draft, ...patch }; latest.current.draft = next; setDraft(next);
    setSegmentEditorDirty(scopeKey, owner, JSON.stringify(next) !== JSON.stringify(latest.current.baseline));
  };
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (dirty || pending.current) return;
    const next = draftFrom(entry); baseVersion.current = fingerprint(entry);
    latest.current.draft = next; latest.current.baseline = next; setDraft(next); setBaseline(next);
  }, [entry]);
  const discard = () => {
    const next = draftFrom(latest.current.entry); latest.current.draft = next; latest.current.baseline = next;
    baseVersion.current = fingerprint(latest.current.entry); setDraft(next); setBaseline(next); setError(null);
  };
  const save = (): Promise<boolean> => {
    if (pending.current) return pending.current;
    const before = latest.current.draft;
    if (!before.title.trim()) { setError('请输入条目标题。'); return Promise.resolve(false); }
    if (fingerprint(latest.current.entry) !== baseVersion.current) {
      setError('条目已在其他位置更新。请返回概览后重新编辑，以免覆盖新内容。'); return Promise.resolve(false);
    }
    if (JSON.stringify(before) === JSON.stringify(latest.current.baseline)) return Promise.resolve(true);
    setSaving(true); setError(null);
    pending.current = Promise.resolve().then(() => onUpdateEntry(entry.id, requestFrom(before))).then(() => {
      if (!live.current) return false;
      latest.current.baseline = before; setBaseline(before);
      baseVersion.current = fingerprint(latest.current.entry);
      const clean = JSON.stringify(latest.current.draft) === JSON.stringify(before);
      setSegmentEditorDirty(scopeKey, owner, !clean);
      notify({ tone: 'success', title: '条目信息已保存' }); return clean;
    }).catch(caught => { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); return false; })
      .finally(() => { pending.current = null; if (live.current) setSaving(false); });
    return pending.current;
  };
  const handlers = useRef({ save, discard }); handlers.current = { save, discard };
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler(scopeKey, owner, {
      save: () => handlers.current.save(), discard: () => handlers.current.discard(),
      isDirty: () => JSON.stringify(latest.current.draft) !== JSON.stringify(latest.current.baseline),
    });
    return () => { unregister(); setSegmentEditorDirty(scopeKey, owner, false); };
  }, [scopeKey, owner]);
  useEffect(() => setSegmentEditorDirty(scopeKey, owner, dirty || saving), [scopeKey, owner, dirty, saving]);
  const guard = useSurfaceCloseGuard({ root: workspaceRoot, onClose: () => undefined });
  const back = () => { if (!pending.current) guard.requestClose([{ pane: 'left', surface: { kind: 'entry-overview', entryId: entry.id }, scopeKey }], onBack); };
  const saveAndBack = () => { void save().then(saved => { if (saved && live.current) onBack(); }); };
  return <div className="size-full min-h-0 min-w-0" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); saveAndBack(); }
    if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('[role="dialog"],[role="menu"],[role="listbox"]')) {
      event.preventDefault(); event.stopPropagation(); back();
    }
  }}>
    <ReaderSurfaceFrame className="bg-card" toolbar={<EntryContentHeader contentTitle="编辑条目" entryTitle={entry.title}>
      <span className="mr-2 text-xs text-muted-foreground" role="status">{saving ? '保存中…' : dirty ? '未保存' : '未修改'}</span>
      <Button size="sm" variant="ghost" disabled={saving} onClick={back}><ArrowLeft size={14} />返回概览</Button>
      <Button size="sm" disabled={saving || !dirty || !draft.title.trim()} onClick={saveAndBack}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存修改</Button>
    </EntryContentHeader>}>
      <ReaderSurfaceBody width="reading">
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <fieldset disabled={saving} className="grid min-w-0 gap-5">
          <div className="grid gap-2"><Label htmlFor={`${id}-title`}>标题</Label><Input autoFocus id={`${id}-title`} value={draft.title} onChange={event => update({ title: event.target.value })} /></div>
          <div className="grid gap-2"><Label htmlFor={`${id}-description`}>描述</Label><Textarea id={`${id}-description`} className="min-h-28 resize-y leading-6" value={draft.description} onChange={event => update({ description: event.target.value })} /></div>
          <div className="grid gap-2"><Label htmlFor={`${id}-tags`}>标签</Label>
            <Input id={`${id}-tags`} placeholder="输入标签路径，以逗号分隔" value={draft.tagInput} onChange={event => update({ tagInput: event.target.value })} />
            {selectedPaths.length ? <div className="flex flex-wrap gap-1.5">{selectedPaths.map(path => <Button key={path} variant="secondary" size="xs" title={path} aria-label={`移除标签 ${path}`} onClick={() => update({ tagInput: selectedPaths.filter(item => item !== path).join(', ') })}><span className="max-w-64 truncate">{path}</span><X size={12} /></Button>)}</div> : null}
            <TagQuickPicker allowMultiple disabled={saving} selectedPaths={selectedPaths} tags={tags} onTogglePath={path => update({ tagInput: (selectedPaths.includes(path) ? selectedPaths.filter(item => item !== path) : [...selectedPaths, path]).join(', ') })} />
          </div>
          <EntryFieldsEditor fields={draft.fields} disabled={saving} onFieldsChange={fields => update({ fields })} />
        </fieldset>
      </ReaderSurfaceBody>
    </ReaderSurfaceFrame>
    {guard.dialog}
  </div>;
}
