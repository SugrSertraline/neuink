import { expect, it } from 'vitest';
import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { answerVerification } from './answerVerification';

it('accepts an arXiv paper presentation from a previous turn after compaction integration', () => {
  const paper = { id: '2401.00001', title: 'Historical result', authors: ['A'], year: '2024',
    abstract_text: 'Abstract', doi: '', url: 'https://arxiv.org/abs/2401.00001',
    pdf_url: 'https://arxiv.org/pdf/2401.00001', provider: 'arxiv', evidence_level: 'abstract' };
  const historicalEvents: AssistantToolTraceEvent[] = [{ id: 'previous-search', toolName: 'arxiv_search',
    status: 'done', researchCacheSource: 'arxiv_search', researchPapers: [paper] }];
  const input = { question: 'Show that paper again',
    answer: '```neuink-papers\n{"items":[{"ref":"research:2401.00001","reason":"Previously retrieved"}]}\n```',
    sources: new Map(), events: [], observations: [], hasProposals: false, availabilityNotes: [] };
  expect(answerVerification({ ...input, historicalEvents })).toBeUndefined();
  expect(answerVerification(input)).toBeDefined();
});
