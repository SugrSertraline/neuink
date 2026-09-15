import { hasAnyUnsavedMarkdownNotes, hasUnsavedMarkdownNote, saveAllMarkdownNotesBeforeWorkspaceChange } from '@/modules/notes/editor/noteDirtyRegistry';
import { hasAnyUnsavedSegmentEditors, hasUnsavedSegmentEditors, saveAllSegmentEditorsBeforeWorkspaceChange } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { surfaceKey, surfaceNoteTarget, type WorkspaceSurface } from './workspaceSurface';
import { noteOwnerKey } from '@/shared/lib/noteOwner';

export function hasUnsavedSurface(surface: WorkspaceSurface) {
  const target = surfaceNoteTarget(surface);
  return (target !== null && hasUnsavedMarkdownNote(noteOwnerKey(target.owner), target.note_id)) ||
    hasUnsavedSegmentEditors(surfaceKey(surface));
}

export function hasAnyUnsavedEdits() {
  return hasAnyUnsavedMarkdownNotes() || hasAnyUnsavedSegmentEditors();
}

export async function saveEditsBeforeWorkspaceChange() {
  if (!await saveAllSegmentEditorsBeforeWorkspaceChange() ||
      !await saveAllMarkdownNotesBeforeWorkspaceChange() || hasAnyUnsavedEdits()) {
    throw new Error('有文档笔记、片段笔记或批注未能保存，或保存期间又有修改。已取消切换资料库，请回到阅读页处理。');
  }
}
