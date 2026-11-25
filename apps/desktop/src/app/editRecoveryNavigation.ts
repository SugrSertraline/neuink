import type { EditRecoveryDraft } from '@/shared/ipc/editRecoveryApi';
import type { UnsavedEditor } from './UnsavedWindowDialog';
import { surfaceKey, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';

export function recoverySurface(draft: EditRecoveryDraft): WorkspaceSurface {
  if (draft.kind === 'settings') return { kind: 'settings', target: { id: draft.targetId, nonce: Date.now() } };
  if (draft.kind === 'entry') return { kind: 'entry-overview', entryId: draft.ownerId };
  if (draft.kind === 'create-entry') return { kind: 'create-entry' };
  if (draft.kind === 'tag-description') return { kind: 'tag-details', tagId: draft.ownerId, view: 'overview' };
  if (draft.kind === 'tag-reading') return { kind: 'tag-reading', tagId: draft.ownerId };
  if (draft.kind === 'todo' || draft.kind === 'daily-state') return { kind: 'daily-dashboard' };
  if (draft.kind !== 'note') return { kind: 'segment-notes', entryId: draft.ownerId, segmentUid: draft.targetId, mode: draft.kind === 'annotation' ? 'annotation' : 'note' };
  if (draft.ownerId.startsWith('daily:')) return { kind: 'owned-note', target: { owner: { kind: 'daily', date: draft.ownerId.slice(6) }, note_id: draft.targetId }, label: draft.label };
  if (draft.ownerId.startsWith('tag-reading:')) return { kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: draft.ownerId.slice(12) }, note_id: draft.targetId }, label: draft.label };
  return { kind: 'note', entryId: draft.ownerId, noteId: draft.targetId };
}
export function unsavedSurface(target: UnsavedEditor, layout: WorkspaceSurfaceLayout): WorkspaceSurface | undefined {
  if (target.scopeKey.startsWith('daily-')) return { kind: 'daily-dashboard' };
  if (target.handler?.settingsTargetId) return { kind: 'settings', target: { id: target.handler.settingsTargetId, nonce: Date.now() } };
  return [...layout.leftTabs, ...layout.rightTabs].sort((a, b) => surfaceKey(b).length - surfaceKey(a).length)
    .find(surface => target.scopeKey === surfaceKey(surface) || target.scopeKey.startsWith(`${surfaceKey(surface)}/`));
}
