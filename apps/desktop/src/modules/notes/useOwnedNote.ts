import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteDocument, NoteTarget, SourceLink } from '@/shared/types/domain';
import { buildOwnedNoteSourceLink, readOwnedNote, saveOwnedNote } from '@/shared/ipc/noteOwnerApi';
import { noteTargetKey, sameNoteTarget } from '@/shared/lib/noteOwner';

export type EntryNoteSave = (entryId: string, noteId: string, title: string, markdown: string, links?: SourceLink[] | null, revision?: string | null) => Promise<NoteDocument>;

export function useOwnedNote(root: string | null, target: NoteTarget | null, onSaveEntryNote?: EntryNoteSave) {
  const [writable, setWritable] = useState(false);
  const [queue, setQueue] = useState<{ key: string; root: string; link: SourceLink }[]>([]);
  const current = useRef({ root, target, writable }); current.current = { root, target, writable };
  const key = target ? noteTargetKey(target) : '';
  useEffect(() => () => { current.current = { root: null, target: null, writable: false }; }, []);
  const load = useCallback(() => root && target ? readOwnedNote(root, target) : Promise.reject(new Error('笔记或资料库不可用。')), [root, key]);
  const save = useCallback((title: string, markdown: string, links: SourceLink[], revision?: string | null) => {
    if (!root || !target || !revision) return Promise.reject(new Error('缺少笔记版本，请重新载入后重试。'));
    return target.owner.kind === 'entry' && onSaveEntryNote
      ? onSaveEntryNote(target.owner.entry_id, target.note_id, title, markdown, links, revision)
      : saveOwnedNote(root, target, { note_id: target.note_id, title, markdown, links, revision });
  }, [root, key, onSaveEntryNote]);
  const buildSource = useCallback(async (entryId: string, segmentUid: string) => {
    const before = current.current;
    if (!before.root || !before.target || !before.writable) throw new Error('请先打开可编辑的文档笔记。');
    const link = await buildOwnedNoteSourceLink(before.root, before.target, entryId, segmentUid);
    if (current.current.root !== before.root || !sameNoteTarget(current.current.target, before.target) || !current.current.writable)
      throw new Error('资料库或目标笔记已切换，未插入来源，请重试。');
    return link;
  }, []);
  const addSource = useCallback(async (entryId: string, segmentUid: string) => {
    const before = current.current;
    const link = await buildSource(entryId, segmentUid);
    if (before.root && before.target) setQueue((items) => [...items, { root: before.root!, key: noteTargetKey(before.target!), link }]);
  }, [buildSource]);
  const inserted = useCallback((link: SourceLink) => setQueue((items) => items.filter((item) => item.link.link_id !== link.link_id)), []);
  return { load, save, writable, setWritable, buildSource, addSource, inserted, pending: queue.find((item) => item.root === root && item.key === key)?.link ?? null };
}
