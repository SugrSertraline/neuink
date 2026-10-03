import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';
import type { AssistantActiveNote, AssistantActiveSegment, AssistantActiveSurfaceSnapshot, AssistantContextItem } from '@/shared/types/assistant';

/** null follows reading; 'none' explicitly opts out of implicit tab/selection context. */
export type AssistantReadingChoice = { tagId: string } | { entryId: string; noteId?: string; contentKind?: 'pdf' } | 'none' | null;
export type AssistantReadingContext = {
  entry: LibraryEntry | null;
  tag: TagMeta | null;
  note: AssistantActiveNote | null;
  segment: AssistantActiveSegment | null;
  surface: AssistantActiveSurfaceSnapshot;
  label: string;
  bound: boolean;
  unavailable: boolean;
  notice?: string;
};

export function resolveAssistantReadingContext({ choice, entries, tags = [], items, activeEntry, activeNote, activeSegment, activeSurface }: {
  choice: AssistantReadingChoice; entries: LibraryEntry[]; tags?: TagMeta[]; items: AssistantContextItem[];
  activeEntry: LibraryEntry | null; activeNote: AssistantActiveNote | null;
  activeSegment: AssistantActiveSegment | null; activeSurface: AssistantActiveSurfaceSnapshot;
}): AssistantReadingContext {
  if (choice === 'none') {
    return {
      entry: null, tag: null, note: null, segment: null, label: '不关联内容', bound: true, unavailable: false,
      // Do not leak the previously active paper/note through the surface snapshot.
      surface: { kind: 'library', surfaceKey: 'library', entryId: null, noteId: null, segmentUid: null,
        capturedAt: activeSurface.capturedAt, pane: activeSurface.pane }
    };
  }
  if (choice && 'tagId' in choice) {
    const tag = tags.find(value => value.id === choice.tagId) ?? null;
    return {
      entry: null, tag, note: null, segment: null, bound: true, unavailable: !tag,
      label: tag ? `标签 · ${tag.name}` : '所选标签已不可用',
      surface: { kind: 'tag-reading', surfaceKey: `tag-reading:${choice.tagId}`, entryId: null,
        noteId: null, segmentUid: null, capturedAt: activeSurface.capturedAt, pane: activeSurface.pane }
    };
  }
  const fixedEntry = choice && 'entryId' in choice ? choice : null;
  const selection = [...items].reverse().find(item => item.kind === 'segment' && item.id.startsWith('selection:'));
  const targetId = fixedEntry?.entryId ?? selection?.entryId;
  if (targetId) {
    const entry = entries.find(value => value.id === targetId) ?? null;
    const content = fixedEntry?.noteId ? entry?.contents.find(value => value.kind === 'note' && value.note_id === fixedEntry.noteId) : null;
    const note = content?.kind === 'note' && entry
      ? { entryId: entry.id, entryTitle: entry.title, noteId: content.note_id, noteTitle: content.title } : null;
    const segment = !fixedEntry && selection?.kind === 'segment' ? {
      entryId: selection.entryId, entryTitle: selection.entryTitle, segmentUid: selection.segmentUid,
      pageIdx: selection.pageIdx, text: selection.text
    } : null;
    const selectedPdf = fixedEntry?.contentKind === 'pdf';
    return { entry, tag: null, note, segment, bound: true, unavailable: !entry || Boolean(fixedEntry?.noteId && !note) || Boolean(selectedPdf && !entry?.pdfFileName),
      label: !entry ? '所选条目已不可用' : fixedEntry?.noteId ? note?.noteTitle ?? '所选笔记已不可用'
        : selectedPdf ? entry.pdfFileName ? `${entry.pdfFileName} · PDF` : '所选 PDF 已不可用'
          : segment ? `${entry.title} · 第 ${segment.pageIdx + 1} 页选区` : entry.title,
      surface: { capturedAt: activeSurface.capturedAt, pane: activeSurface.pane,
        entryId: targetId, noteId: note?.noteId ?? null, segmentUid: segment?.segmentUid ?? null,
        kind: note ? 'note' : selectedPdf ? 'pdf' : 'entry-overview',
        surfaceKey: note ? `note:${targetId}:${note.noteId}` : selectedPdf ? `pdf:${targetId}` : `entry-overview:${targetId}` }
    };
  }
  const missing = Boolean(activeSurface.entryId && !activeEntry) || Boolean(activeSurface.noteId && !activeNote);
  const browserTab = activeSurface.kind === 'browser' ? activeSurface.browserTab : undefined;
  const neutral = activeSurface.kind === 'browser' ? browserTab ? `网页 · ${browserTab.title}` : '网页（尚未就绪）'
    : activeSurface.kind === 'owned-note' && !activeEntry ? '标签笔记（未附正文）' : '资料库';
  return { entry: activeEntry, tag: null, note: activeNote, segment: activeSegment, surface: activeSurface,
    label: missing ? '当前阅读对象已不可用' : activeNote?.noteTitle ?? activeEntry?.title ?? neutral, bound: false, unavailable: missing,
    notice: activeSurface.kind === 'browser' ? browserTab
      ? '提问时，助手可按需读取此网页当前显示的正文，并发送给已配置的模型。选择“不关联内容”可取消本次网页关联。'
      : '当前网页尚不可读取，请打开网页并等待加载完成；仍可正常提问。'
      : activeSurface.kind === 'owned-note' && !activeEntry ? '标签笔记尚未接入助手的直接读写工具。可附上文字提问，不会改用旁边的论文。' : undefined };
}
