import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { sentenceTranslation } from '@/shared/ipc/sentenceTranslationApi';
import { getLlmSettings } from '@/shared/ipc/assistantApi';
import { getTranslationRouting, resolvedTranslationSource } from '@/shared/ipc/translationRoutingApi';
import { translateSelectionService } from '@/shared/ipc/selectionTranslationApi';
import { translationSourceProfile } from './translationSource';
import { translateSelectionWithProfile } from './modelSelectionTranslation';

export type SentenceTranslationTarget = { root: string; entryId: string; segmentUid: string; paragraph: string; sentence: string; start: number };
export function SentenceTranslationLauncher({ target }: { target: SentenceTranslationTarget }) {
  const [open, setOpen] = useState(false);
  return <div className="mt-1">
    <Button size="xs" variant="ghost" onClick={() => setOpen(value => !value)}>{open ? '收起单句翻译' : '翻译此句／查看已保存译文'}</Button>
    {open && <SentenceTranslationAction target={target} />}
  </div>;
}
/** Preview owns its transient request; only explicit save persists the independent sentence. */
export function SentenceTranslationAction({ target }: { target: SentenceTranslationTarget }) {
  const [saved, setSaved] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const identity = JSON.stringify(target);
  const current = useRef(identity); current.current = identity;
  const byteStart = new TextEncoder().encode(target.paragraph.slice(0, target.start)).length;
  useEffect(() => {
    let live = true;
    setSaved(undefined); setDraft(undefined); setReady(false); setError(''); setBusy(false);
    void sentenceTranslation(target.root, target.entryId).then(records => {
      if (!live) return;
      const record = records[`${target.segmentUid}:${byteStart}`];
      if (record?.paragraph_source === target.paragraph && record.source === target.sentence) setSaved(record.translation);
      setReady(true);
    }).catch(() => { if (live) setError('无法读取单句译文，请重新打开预览。'); });
    return () => { live = false; request.current?.abort(); };
  }, [identity]);
  const translate = async () => {
    if (busy || !ready) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setDraft(undefined);
    try {
      const origin = resolvedTranslationSource(await getTranslationRouting(), 'paragraph');
      let text: string | null = null;
      if (origin.kind === 'service' || origin.kind === 'selection_service') text = await translateSelectionService(target.sentence,
        origin.kind === 'service' ? origin.provider : undefined, controller.signal);
      if (text === null && origin.kind === 'service') throw new Error('empty');
      if (text === null) text = await translateSelectionWithProfile(translationSourceProfile(await getLlmSettings(),
        origin.kind === 'selection_service' ? { kind: 'default_model' } : origin), { sourceText: target.sentence, entryTitle: '' }, { signal: controller.signal });
      if (!text.trim()) throw new Error('empty');
      if (!controller.signal.aborted && current.current === identity) setDraft(text);
    } catch { if (!controller.signal.aborted && current.current === identity) setError('单句翻译失败，可重试；原有译文保留。'); }
    finally { if (current.current === identity) setBusy(false); }
  };
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try {
      await sentenceTranslation(target.root, target.entryId, { segment_uid: target.segmentUid, paragraph_source: target.paragraph,
        source: target.sentence, source_start: byteStart, translation: draft }, saved);
      if (current.current === identity) { setSaved(draft); setDraft(undefined); }
    } catch { if (current.current === identity) setError('保存失败或内容已变化，请重新打开预览后重试。'); }
    finally { if (current.current === identity) setBusy(false); }
  };
  return <div className="mt-2 space-y-2 border-t border-border pt-2 text-xs" onClick={event => event.stopPropagation()}>
    {saved && <div><p className="font-medium">已保存的单句译文</p><p className="whitespace-pre-wrap">{saved}</p></div>}
    {draft && <div><p className="font-medium">新译文预览 · 尚未保存</p><p className="whitespace-pre-wrap">{draft}</p></div>}
    <div className="flex flex-wrap gap-2">
      <Button size="xs" variant="outline" disabled={busy || !ready} onClick={() => void translate()}>{busy ? '正在处理…' : saved ? '重新翻译此句' : '翻译此句'}</Button>
      {draft && <><Button size="xs" disabled={busy} onClick={() => void save()}>保存单句译文</Button><Button size="xs" variant="ghost" disabled={busy} onClick={() => setDraft(undefined)}>放弃</Button></>}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
