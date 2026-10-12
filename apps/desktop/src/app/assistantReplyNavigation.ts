import type { WorkspacePaneId, WorkspaceSurfaceLayout } from './workspaceSurface';
import { surfaceKey } from './workspaceSurface';
import type { LocalConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { PdfJumpRequest } from '@/modules/reader/types';

/** Use the visible reply as the origin even after evidence has received focus. */
export function assistantReplyEvidencePane(layout: WorkspaceSurfaceLayout, replyId?: string): WorkspacePaneId | undefined {
  if (!replyId) return undefined;
  for (const pane of ['left', 'right'] as const) {
    const surface = layout[pane];
    if (surface?.kind === 'assistant-reply' && surface.message.message_id === replyId) {
      return pane === 'left' ? 'right' : 'left';
    }
  }
  return undefined;
}

export function assistantEvidenceNavigation(layout: WorkspaceSurfaceLayout, source: LocalConversationSourceLink, requestKey: number, replyId?: string) {
  const pane = assistantReplyEvidencePane(layout, replyId);
  // Preserve an already-visible copy's identity; it owns its scroll and history.
  const visible = layout[pane ?? layout.focusedPane];
  const surface = visible?.kind === 'pdf' && visible.entryId === source.entry_id
    ? visible : { kind: 'pdf' as const, entryId: source.entry_id };
  const jump: PdfJumpRequest = { kind: source.segment_uid ? 'segment' : 'page',
    segmentUid: source.segment_uid, pageIdx: source.page_idx, requestKey, targetSurfaceKey: surfaceKey(surface) };
  return { surface, pane, jump };
}
