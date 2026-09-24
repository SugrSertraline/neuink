import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { AssistantActiveNote, AssistantActiveSegment, AssistantActiveSurfaceSnapshot, AssistantContextItem } from '@/shared/types/assistant';

export type AssistantReadingChoice = { entryId: string; noteId?: string } | null;
export type AssistantReadingContext = {
  entry: LibraryEntry | null;
  note: AssistantActiveNote | null;
  segment: AssistantActiveSegment | null;
  surface: AssistantActiveSurfaceSnapshot;
  label: string;
  bound: boolean;
  unavailable: boolean;
};

export function resolveAssistantReadingContext({ choice, entries, items, activeEntry, activeNote, activeSegment, activeSurface }: {
  choice: AssistantReadingChoice; entries: LibraryEntry[]; items: AssistantContextItem[];
  activeEntry: LibraryEntry | null; activeNote: AssistantActiveNote | null;
  activeSegment: AssistantActiveSegment | null; activeSurface: AssistantActiveSurfaceSnapshot;
}): AssistantReadingContext {
  const selection = [...items].reverse().find(item => item.kind === 'segment' && item.id.startsWith('selection:'));
  const targetId = choice?.entryId ?? selection?.entryId;
  if (targetId) {
    const entry = entries.find(value => value.id === targetId) ?? null;
    const content = choice?.noteId ? entry?.contents.find(value => value.kind === 'note' && value.note_id === choice.noteId) : null;
    const note = content?.kind === 'note' && entry
      ? { entryId: entry.id, entryTitle: entry.title, noteId: content.note_id, noteTitle: content.title } : null;
    const segment = !choice && selection?.kind === 'segment' ? {
      entryId: selection.entryId, entryTitle: selection.entryTitle, segmentUid: selection.segmentUid,
      pageIdx: selection.pageIdx, text: selection.text
    } : null;
    return { entry, note, segment, bound: true, unavailable: !entry || Boolean(choice?.noteId && !note),
      label: !entry ? '所选论文已不可用' : choice?.noteId ? note?.noteTitle ?? '所选笔记已不可用'
        : segment ? `${entry.title} · 第 ${segment.pageIdx + 1} 页选区` : entry.title,
      surface: { ...activeSurface, entryId: targetId, noteId: note?.noteId ?? null, segmentUid: segment?.segmentUid ?? null,
        kind: note ? 'note' : 'entry-overview', surfaceKey: note ? `note:${targetId}:${note.noteId}` : `entry-overview:${targetId}` }
    };
  }
  return { entry: activeEntry, note: activeNote, segment: activeSegment, surface: activeSurface,
    label: activeNote?.noteTitle ?? activeEntry?.title ?? '资料库', bound: false, unavailable: false };
}
