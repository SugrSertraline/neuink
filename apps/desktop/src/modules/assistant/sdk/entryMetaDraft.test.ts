import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readEntryAssistantContext } from '@/shared/ipc/assistantApi';
import type { AssistantTaskPlan } from '@/shared/types/assistant';

import { extractExplicitTitle, generateEntryMetaDraftProposal } from './entryMetaDraft';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/shared/ipc/assistantApi')>(),
  readEntryAssistantContext: vi.fn()
}));

beforeEach(() => vi.clearAllMocks());

describe('generateEntryMetaDraftProposal', () => {
  it('reads the target paper and creates a cited title proposal', async () => {
    vi.mocked(readEntryAssistantContext).mockResolvedValue({
      entry_id: 'entry-1',
      entry_title: 'old.pdf',
      markdown: '# Reliable Agent Workflows [S1]',
      sources: [source()]
    });
    vi.mocked(generateText).mockResolvedValue({
      text: '{"title":"Reliable Agent Workflows","source_markers":[1]}'
    } as never);

    const proposal = await generateEntryMetaDraftProposal({
      availableEntries: [entry()],
      plan: plan(true),
      question: '把条目的标题改成论文的标题',
      root: 'C:/workspace',
      settings: settings()
    });

    expect(readEntryAssistantContext).toHaveBeenCalledWith({
      entryId: 'entry-1', root: 'C:/workspace'
    });
    expect(proposal.afterTitle).toBe('Reliable Agent Workflows');
    expect(proposal.sources).toMatchObject([{ entryId: 'entry-1', marker: 'S1' }]);
  });

  it('repairs a title proposal when the model omits source_markers', async () => {
    vi.mocked(readEntryAssistantContext).mockResolvedValue({
      entry_id: 'entry-1',
      entry_title: 'old.pdf',
      markdown: '# old.pdf\n\n[S1] segment_uid: segment-1\nReliable Agent Workflows',
      sources: [source()]
    });
    vi.mocked(generateText).mockResolvedValue({
      text: '{"title":"Reliable Agent Workflows"}'
    } as never);

    const proposal = await generateEntryMetaDraftProposal({
      availableEntries: [entry()],
      plan: plan(true),
      question: '把这个条目的标题，修改为论文标题',
      root: 'C:/workspace',
      settings: settings()
    });

    expect(proposal.afterTitle).toBe('Reliable Agent Workflows');
    expect(proposal.sources).toMatchObject([{ entryId: 'entry-1', marker: 'S1' }]);
  });

  it('uses an explicit requested title without reading paper evidence', async () => {
    const proposal = await generateEntryMetaDraftProposal({
      availableEntries: [entry()],
      plan: plan(false),
      question: '把条目标题改为 Reliable Agents',
      root: 'C:/workspace',
      settings: settings()
    });

    expect(proposal.afterTitle).toBe('Reliable Agents');
    expect(proposal.sources).toEqual([]);
    expect(readEntryAssistantContext).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it('does not mistake a paper-title reference for a literal title', () => {
    expect(extractExplicitTitle('把条目标题改成论文的标题')).toBeUndefined();
  });

  it('accepts an exact title supplied after a clarification', () => {
    expect(extractExplicitTitle(
      '把这个条目的标题修改为论文标题\n用户补充要求：准确标题是 Reliable Agent Workflows'
    )).toBe('Reliable Agent Workflows');
  });
});

function entry() {
  return { description: '', id: 'entry-1', title: 'old.pdf', updatedAt: 'v1' };
}

function source() {
  return {
    entry_id: 'entry-1', entry_title: 'old.pdf', page_idx: 0,
    quote: 'Reliable Agent Workflows', segment_uid: 'segment-1'
  };
}

function plan(needsDocumentContext: boolean): AssistantTaskPlan {
  return {
    attachments: [], capabilities: ['propose_entry_meta_change'],
    citationPolicy: needsDocumentContext ? 'required' : 'none',
    confidence: 1, deliverables: ['entry_meta_change_proposal'],
    entryMetaChange: { entryId: 'entry-1', fields: ['title'] },
    intent: 'entry_meta_update', missing: [], needsCurrentNote: false,
    needsDocumentContext, needsNoteProposal: false, needsSegmentSearch: false,
    rationale: '', steps: [], target: { entryId: 'entry-1', kind: 'entry_meta' }
  };
}

function settings() {
  return {
    api_key: 'test', base_url: 'http://localhost', id: 'test', max_context_length: 8192,
    max_output_tokens: 1024, model: 'test-model', name: 'Test', temperature: 0, top_p: 1
  };
}
