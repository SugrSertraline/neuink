import type { AssistantNoteProposal } from '@/shared/types/assistant';

import { stableHash } from './evidenceLedger';

export function finalizeVerifiedProposals(
  proposals: AssistantNoteProposal[],
  taskId: string
) {
  const verifiedAt = new Date().toISOString();
  return proposals.map((proposal) => {
    const baseContentHash = proposal.beforeMarkdown === undefined
      ? null
      : stableHash(proposal.beforeMarkdown ?? '');
    const proposalDigest = stableHash(JSON.stringify({
      action: proposal.action,
      baseContentHash,
      entryId: proposal.entryId,
      markdown: proposal.markdown,
      noteId: proposal.noteId ?? null,
      patchOperations: canonicalPatchOperations(proposal),
      segmentUid: proposal.segmentUid ?? null,
      sources: proposal.sources.map((source) => ({
        entryId: source.entryId,
        entryTitle: source.entryTitle,
        marker: source.marker ?? null,
        pageIdx: source.pageIdx,
        quote: source.quote,
        segmentUid: source.segmentUid
      })),
      targetKind: proposal.targetKind ?? 'markdown_note',
      title: proposal.title
    }));
    return {
      ...proposal,
      baseContentHash,
      idempotencyKey: `apply-${taskId}-${proposal.id}-${proposalDigest}`,
      proposalDigest,
      taskId,
      verifiedAt
    };
  });
}

function canonicalPatchOperations(proposal: AssistantNoteProposal) {
  return (proposal.patchOperations ?? []).map((operation) => {
    if (operation.type === 'replace_exact') {
      return {
        type: operation.type,
        newText: operation.newText,
        oldText: operation.oldText
      };
    }
    if (operation.type === 'append') {
      return { type: operation.type, text: operation.text };
    }
    if (operation.type === 'replace_lines') {
      return {
        type: operation.type,
        startLine: operation.startLine,
        endLine: operation.endLine,
        expectedText: operation.expectedText,
        newText: operation.newText
      };
    }
    if (operation.type === 'delete_lines') {
      return {
        type: operation.type,
        startLine: operation.startLine,
        endLine: operation.endLine,
        expectedText: operation.expectedText
      };
    }
    if (operation.type === 'insert_lines') {
      return {
        type: operation.type,
        line: operation.line,
        position: operation.position,
        expectedText: operation.expectedText,
        text: operation.text
      };
    }
    return {
      type: operation.type,
      anchorText: operation.anchorText,
      text: operation.text
    };
  });
}
