import { describe, expect, it } from 'vitest';

import type { AssistantTaskPlan } from '@/shared/types/assistant';

import { buildTagProposal } from './tagProposal';

it('builds a confirmable Entry Tag proposal', () => {
  const plan: AssistantTaskPlan = {
    attachments: [], capabilities: ['propose_tag_change'], confidence: 1,
    deliverables: ['tag_change_proposal'], intent: 'tag_attach', missing: [],
    needsCurrentNote: false, needsDocumentContext: false, needsNoteProposal: false,
    needsSegmentSearch: false, rationale: 'test', steps: [],
    tagChange: { action: 'attach', entryIds: ['entry-1'], name: 'RAG' },
    target: { kind: 'chat_only' }
  };

  const proposal = buildTagProposal(plan);
  expect(proposal.action).toBe('attach');
  expect(proposal.entryIds).toEqual(['entry-1']);
  expect(proposal.status).toBe('pending');
});
