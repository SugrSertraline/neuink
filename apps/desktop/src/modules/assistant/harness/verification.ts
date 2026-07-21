import type { AssistantContextSnapshot } from '@/shared/ipc/assistantApi';
import { isLocalConversationSource, isSciverseConversationSource } from '@/shared/ipc/assistantApi';
import type { AgentInvocationPlan, AssistantTaskPlan } from '@/shared/types/assistant';
import type { AgentExecutionSelection } from '@/shared/types/agentRuntime';

import type { GroundedAnswer } from '../sdk/qna';

export function shouldClarify(plan: AssistantTaskPlan) {
  return plan.confidence < 0.65 || plan.missing.length > 0;
}

export function verifyHarnessResult({
  activeExecution,
  grounded,
  invocationPlan,
  plan,
  snapshot
}: {
  activeExecution: AgentExecutionSelection;
  grounded: GroundedAnswer;
  invocationPlan: AgentInvocationPlan;
  plan: AssistantTaskPlan;
  snapshot: AssistantContextSnapshot;
}) {
  const warnings: string[] = [];
  const errors: string[] = [];
  const proposals = grounded.noteProposals ?? [];
  const entryMetaProposals = grounded.entryMetaProposals ?? [];
  const tagProposals = grounded.tagProposals ?? [];
  const toolEvents = grounded.toolEvents ?? [];
  const wantsTag = plan.deliverables.includes('tag_change_proposal');
  const wantsEntryMeta = plan.deliverables.includes('entry_meta_change_proposal');

  if (plan.needsNoteProposal && proposals.length === 0) {
    errors.push('A note proposal was required, but no proposal was generated.');
  }
  if (wantsEntryMeta && entryMetaProposals.length === 0) {
    errors.push('An Entry metadata proposal was required, but no proposal was generated.');
  }
  if (!wantsEntryMeta && entryMetaProposals.length > 0) {
    errors.push('A non-Entry-metadata task produced an Entry metadata proposal.');
  }
  if (wantsTag && tagProposals.length === 0) {
    errors.push('A Tag proposal was required, but no proposal was generated.');
  }
  if (!wantsTag && tagProposals.length > 0) {
    errors.push('A non-Tag task produced a Tag proposal.');
  }
  if (invocationPlan.writePolicy === 'chat_only' && proposals.length > 0) {
    errors.push('A chat-only task produced an unauthorized note proposal.');
  }

  verifyProposals(proposals, plan, errors);
  verifyEntryMetaProposals(entryMetaProposals, plan, errors);
  if (invocationPlan.noteEditMode === 'patch' && snapshot.active_note &&
    proposals.some((proposal) => proposal.noteId && proposal.action !== 'patch')) {
    warnings.push('The invocation plan requested patch edits, but a proposal was not a patch.');
  }
  if (plan.needsSegmentSearch && grounded.sources.length === 0 &&
    snapshot.pinned_segments.length === 0 &&
    !toolEvents.some((event) => event.toolName === 'search_segments')) {
    warnings.push('The plan requested segment search, but no search evidence was produced.');
  }
  if (plan.deliverables.includes('chat_answer') &&
    plan.citationPolicy === 'required' && grounded.sources.length === 0) {
    errors.push('A paper-grounded answer was produced without a valid source citation.');
  }
  if (
    invocationPlan.sourcePolicy === 'sciverse_only' &&
    (grounded.sources.length === 0 || grounded.sources.some((source) => !isSciverseConversationSource(source)))
  ) {
    errors.push('The task required Sciverse-only evidence, but the final sources did not satisfy that policy.');
  }
  if (
    invocationPlan.sourcePolicy === 'workspace_only' &&
    grounded.sources.some((source) => !isLocalConversationSource(source))
  ) {
    errors.push('The task required workspace-only evidence, but an external source was included.');
  }
  if (
    invocationPlan.sourcePolicy === 'active_context_only' &&
    (plan.intent === 'paper_qa' || plan.intent === 'paper_summary') &&
    plan.target.entryId &&
    !grounded.sources.some(
      (source) => isLocalConversationSource(source) && source.entry_id === plan.target.entryId
    )
  ) {
    errors.push('The current-paper answer has no citation from the frozen active Entry.');
  }
  if (plan.needsNoteProposal && plan.citationPolicy === 'required' &&
    proposals.some((proposal) => proposal.sources.length === 0)) {
    errors.push('A paper-grounded note proposal was produced without a valid source citation.');
  }
  if (wantsEntryMeta && plan.citationPolicy === 'required' &&
    entryMetaProposals.some((proposal) => proposal.sources.length === 0)) {
    errors.push('A paper-grounded Entry metadata proposal has no valid source citation.');
  }
  if (wantsEntryMeta && plan.citationPolicy === 'required' &&
    entryMetaProposals.some((proposal) =>
      proposal.sources.length > 0 &&
      !proposal.sources.some((source) => source.entryId === proposal.entryId)
    )) {
    errors.push('A paper-grounded Entry metadata proposal has no citation from its target Entry.');
  }
  if (!activeExecution.agent.permissions.canWriteProposals &&
    (proposals.length > 0 || entryMetaProposals.length > 0 || tagProposals.length > 0)) {
    errors.push('The selected agent is not allowed to write proposals.');
  }
  return { errors, warnings };
}

function verifyEntryMetaProposals(
  proposals: NonNullable<GroundedAnswer['entryMetaProposals']>,
  plan: AssistantTaskPlan,
  errors: string[]
) {
  for (const proposal of proposals) {
    if (!plan.entryMetaChange?.entryId || proposal.entryId !== plan.entryMetaChange.entryId) {
      errors.push('An Entry metadata proposal targeted the wrong Entry.');
    }
    const expectedFields = new Set(plan.entryMetaChange?.fields ?? []);
    if (proposal.fields.some((field) => !expectedFields.has(field)) ||
      proposal.fields.length !== expectedFields.size) {
      errors.push('An Entry metadata proposal changed fields outside the confirmed task.');
    }
    if (!proposal.afterTitle.trim()) {
      errors.push('An Entry metadata proposal produced an empty title.');
    }
  }
}

export function compactVerifierText(text: string, maxLength: number) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

export function planToHarnessIntent(plan: AssistantTaskPlan) {
  if (plan.capabilities.includes('search_evidence')) return 'lookup' as const;
  if (plan.capabilities.includes('propose_note')) return 'note_edit' as const;
  return 'qa' as const;
}

export class AssistantVerificationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(' '));
    this.name = 'AssistantVerificationError';
  }
}

function verifyProposals(
  proposals: NonNullable<GroundedAnswer['noteProposals']>,
  plan: AssistantTaskPlan,
  errors: string[]
) {
  for (const proposal of proposals) {
    if (plan.target.entryId && proposal.entryId !== plan.target.entryId) {
      errors.push('A note proposal targeted an Entry outside the confirmed Task target.');
    }
    if (plan.target.kind === 'markdown_note' && plan.target.noteId &&
      proposal.noteId !== plan.target.noteId) {
      errors.push('A note proposal targeted the wrong Markdown note.');
    }
    if (plan.target.kind === 'segment_note' && plan.target.segmentUid &&
      proposal.segmentUid !== plan.target.segmentUid) {
      errors.push('A note proposal targeted the wrong Source Segment.');
    }
    if (plan.noteAction && proposal.action !== plan.noteAction) {
      errors.push('A note proposal used a different operation from the confirmed Task.');
    }
    if (proposal.action !== 'create' && proposal.beforeMarkdown === null) {
      errors.push('An existing-note proposal did not capture its base content.');
    }
    if (/(无法.{0,8}(编辑|写入)|手动复制|请选择|是否要)/u.test(proposal.markdown)) {
      errors.push('A note proposal contains workflow commentary instead of note content.');
    }
  }
}
