import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta, NoteTarget, ReadingMode, TagMeta } from '@/shared/types/domain';
import { sameNoteTarget } from '@/shared/lib/noteOwner';

export type TagMemberStatus = 'unread' | 'reading' | 'done' | 'skipped';
export type TagMemberReadingState = { status: TagMemberStatus; order: number; updated_at: string };
export type TagReadingState = {
  version: number; revision: number; tag_id: string; include_descendants: boolean;
  active_entry_id: string | null; compare_entry_id: string | null;
  active_note?: NoteTarget | null; auxiliary_view?: 'compare' | 'note';
  queue_collapsed: boolean; split_ratio: number;
  member_states: Record<string, TagMemberReadingState>; updated_at: string;
};
export type TagReadingMember = {
  entry_id: string; title: string; pdf_available: boolean; reflow_available: boolean;
  preferred_mode: ReadingMode; issue: string | null;
};
export type TagReadingResponse = { state: TagReadingState; members: TagReadingMember[] };
export type TagArchive = { archive_id: string; root_tag: TagMeta; tags: TagMeta[]; deleted_at: string };

export const readTagReading = (root: string, tagId: string) =>
  invoke<TagReadingResponse>('read_tag_reading', { request: { root, tag_id: tagId } });
export async function saveTagReading(root: string, state: TagReadingState) {
  const saved = await invoke<TagReadingState>('save_tag_reading', { request: { root, state, expected_revision: state.revision } });
  if (state.active_note && (!sameNoteTarget(state.active_note, saved.active_note) || state.auxiliary_view !== saved.auxiliary_view)) {
    throw new Error('桌面后端尚未支持文档笔记布局，请重启项目并重新载入阅读进度。笔记文件未删除。');
  }
  return saved;
}
export const listTagArchives = (root: string) =>
  invoke<TagArchive[]>('list_tag_archives', { request: { root } });
export const restoreTagArchive = (root: string, archiveId: string) =>
  invoke<{ tags: TagMeta[]; entries: EntryMeta[]; missing_entries: number }>('restore_tag_archive', { request: { root, archive_id: archiveId } });
