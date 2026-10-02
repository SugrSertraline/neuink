import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { noteReviewVersions } from '../review/noteReviewDiff';

export type NoteProposalPreviewModel =
  | { kind: 'change'; label: 'Added' | 'Removed'; text: string; tone: 'after' | 'before' }
  | { after: string; before: string; kind: 'diff' }
  | { kind: 'markdown'; text: string };

export function buildNoteProposalPreview(
  proposal: AssistantNoteProposal
): NoteProposalPreviewModel {
  // Renderable previews need complete versions, not removed characters or
  // line slices which can cut a diagram, formula or table in half.
  if (proposal.targetKind !== 'segment_note' && (['create', 'patch', 'delete'].includes(proposal.action) || proposal.beforeMarkdown != null)) {
    const { before, after } = noteReviewVersions(proposal);
    return { kind: 'diff', before, after };
  }
  if (proposal.beforeMarkdown != null && proposal.afterMarkdown != null) {
    return { kind: 'diff', before: proposal.beforeMarkdown, after: proposal.afterMarkdown };
  }
  if (proposal.action === 'append' || proposal.action === 'prepend') {
    return { kind: 'change', label: 'Added', text: proposal.markdown, tone: 'after' };
  }

  return { kind: 'markdown', text: proposal.markdown };
}
