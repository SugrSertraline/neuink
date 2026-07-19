import { describe, expect, it } from 'vitest';

import type { AssistantContextSnapshot } from '@/shared/ipc/assistantApi';
import type { AgentExecutionSelection } from '@/shared/types/agentRuntime';
import type { AgentInvocationPlan, AssistantTaskPlan } from '@/shared/types/assistant';

import type { GroundedAnswer } from '../sdk/qna';
import { verifyHarnessResult } from './verification';

const activeExecution = {
  agent: { permissions: { canWriteProposals: true } },
  skillPackages: []
} as unknown as AgentExecutionSelection;

const invocationPlan = {
  enabledToolIds: [],
  mainAssistantId: 'main',
  missing: [],
  mode: 'agent_execute',
  noteEditMode: 'append',
  rationale: '',
  skillIdsToLoad: [],
  subagentTasks: [],
  writePolicy: 'proposal_only'
} satisfies AgentInvocationPlan;

const snapshot = {
  active_entry: { entry_id: 'entry-1', entry_title: 'Paper' },
  active_note: null,
  document: {
    entry_id: 'entry-1',
    entry_title: 'Paper',
    markdown: '# Paper',
    sources: [{ entry_id: 'entry-1' }]
  },
  pinned_segments: [],
  warnings: []
} as unknown as AssistantContextSnapshot;

describe('verifyHarnessResult note citations', () => {
  it('allows a general-knowledge append when an unrelated paper is open', () => {
    expect(verifyHarnessResult({
      activeExecution,
      grounded: groundedProposal(),
      invocationPlan,
      plan: notePlan(false),
      snapshot
    }).errors).not.toContain(
      'A paper-grounded note proposal was produced without a valid source citation.'
    );
  });

  it('still blocks a paper-grounded proposal without citations', () => {
    expect(verifyHarnessResult({
      activeExecution,
      grounded: groundedProposal(),
      invocationPlan,
      plan: notePlan(true),
      snapshot
    }).errors).toContain(
      'A paper-grounded note proposal was produced without a valid source citation.'
    );
  });
});

describe('verifyHarnessResult Entry metadata proposals', () => {
  it('accepts an exact paper-grounded title and description proposal', () => {
    const result = verifyHarnessResult({
      activeExecution,
      grounded: entryMetaGrounded(true),
      invocationPlan,
      plan: entryMetaPlan(),
      snapshot
    });

    expect(result.errors).toEqual([]);
  });

  it('blocks an Entry metadata proposal without paper evidence', () => {
    const result = verifyHarnessResult({
      activeExecution,
      grounded: entryMetaGrounded(false),
      invocationPlan,
      plan: entryMetaPlan(),
      snapshot
    });

    expect(result.errors).toContain(
      'A paper-grounded Entry metadata proposal has no valid source citation.'
    );
  });

  it('blocks evidence that belongs only to a different Entry', () => {
    const grounded = entryMetaGrounded(true);
    grounded.entryMetaProposals![0].sources[0].entryId = 'entry-2';

    expect(verifyHarnessResult({
      activeExecution,
      grounded,
      invocationPlan,
      plan: entryMetaPlan(),
      snapshot
    }).errors).toContain(
      'A paper-grounded Entry metadata proposal has no citation from its target Entry.'
    );
  });
});

function notePlan(needsDocumentContext: boolean): AssistantTaskPlan {
  return {
    attachments: [],
    capabilities: needsDocumentContext
      ? ['read_document', 'synthesize', 'propose_note']
      : ['synthesize', 'propose_note'],
    citationPolicy: needsDocumentContext ? 'required' : 'none',
    confidence: 1,
    deliverables: ['note_patch_proposal'],
    intent: 'note_update',
    evidencePolicy: needsDocumentContext ? 'required' : 'none',
    missing: [],
    needsCurrentNote: true,
    needsDocumentContext,
    needsNoteProposal: true,
    needsSegmentSearch: false,
    noteAction: 'append',
    rationale: '',
    request: '追加一个质能方程',
    steps: [{ dependsOn: [], id: 'draft', kind: 'draft_note' }],
    target: { entryId: 'entry-1', kind: 'markdown_note', noteId: 'note-1' }
  };
}

function groundedProposal(): GroundedAnswer {
  return {
    answer: '已生成提案。',
    noteProposals: [{
      action: 'append',
      beforeMarkdown: '# Existing',
      createdAt: '2026-07-14T00:00:00Z',
      entryId: 'entry-1',
      entryTitle: 'Paper',
      id: 'proposal-1',
      markdown: '$$E = mc^2$$',
      noteId: 'note-1',
      sources: [],
      status: 'pending',
      title: 'Append equation'
    }],
    sources: []
  };
}

function entryMetaPlan(): AssistantTaskPlan {
  return {
    attachments: [],
    capabilities: ['read_document', 'synthesize', 'propose_entry_meta_change'],
    citationPolicy: 'required',
    confidence: 1,
    deliverables: ['entry_meta_change_proposal'],
    entryMetaChange: { entryId: 'entry-1', fields: ['title', 'description'] },
    evidencePolicy: 'required',
    intent: 'entry_meta_update',
    missing: [],
    needsCurrentNote: false,
    needsDocumentContext: true,
    needsNoteProposal: false,
    needsSegmentSearch: false,
    rationale: '',
    steps: [{ dependsOn: [], id: 'entry-meta', kind: 'propose_entry_meta_change' }],
    target: { entryId: 'entry-1', kind: 'entry_meta' }
  };
}

function entryMetaGrounded(withSources: boolean): GroundedAnswer {
  const sources = withSources ? [{
    entryId: 'entry-1', entryTitle: 'Paper', marker: 'S1', pageIdx: 0,
    quote: 'Paper evidence', segmentUid: 'segment-1'
  }] : [];
  return {
    answer: 'Prepared metadata.',
    entryMetaProposals: [{
      afterDescription: 'New description', afterTitle: 'New title',
      baseUpdatedAt: '2026-07-14T00:00:00Z', beforeDescription: '',
      beforeTitle: 'Paper', createdAt: '2026-07-14T00:00:00Z',
      entryId: 'entry-1', entryTitle: 'Paper', fields: ['title', 'description'],
      id: 'entry-proposal-1', sources, status: 'pending'
    }],
    sources: withSources ? [{
      entry_id: 'entry-1', entry_title: 'Paper', page_idx: 0,
      quote: 'Paper evidence', segment_uid: 'segment-1'
    }] : []
  };
}
