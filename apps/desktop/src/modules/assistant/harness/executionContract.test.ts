import { describe, expect, it } from 'vitest';

import type { AssistantContextSnapshot } from '@/shared/ipc/assistantApi';

import { compileAssistantExecutionContract } from './executionContract';

function snapshot({ note = false } = {}): AssistantContextSnapshot {
  return {
    active_entry: {
      entry_id: 'entry-1', entry_title: 'Paper', has_pdf: true, parse_status: 'completed'
    },
    active_note: note
      ? {
          entry_id: 'entry-1', entry_title: 'Paper', markdown: '# Note',
          markdown_char_count: 6, note_id: 'note-1', note_title: 'Note',
          source_link_count: 0, truncated: false
        }
      : null,
    document: null,
    pinned_segments: [],
    warnings: []
  };
}

describe('assistant execution contracts', () => {
  it('binds current-paper questions to a required active-document read', () => {
    const contract = compileAssistantExecutionContract({
      activeSurface: {
        capturedAt: '2026-07-20T00:00:00Z', entryId: 'entry-1', kind: 'pdf',
        noteId: null, pane: 'right', segmentUid: null, surfaceKey: 'pdf:entry-1'
      },
      question: '当前论文讲了什么？',
      snapshot: snapshot()
    });

    expect(contract.plan.intent).toBe('paper_summary');
    expect(contract.requiredToolIds).toEqual(['read_entry_assistant_context']);
    expect(contract.sourcePolicy).toBe('active_context_only');
    expect(contract.failurePolicy).toBe('stop');
  });

  it('routes external literature requests to Sciverse without naming the provider', () => {
    const contract = compileAssistantExecutionContract({
      question: '请检索外部文献，分析蛋白质折叠研究的主要局限。',
      snapshot: snapshot()
    });

    expect(contract.plan.intent).toBe('paper_search');
    expect(contract.requiredToolIds).toContain('search_sciverse_evidence');
    expect(contract.sourcePolicy).toBe('sciverse_only');
  });

  it('infers scholarly retrieval for an evidence-oriented scientific question', () => {
    const contract = compileAssistantExecutionContract({
      question: 'AlphaFold2 蛋白质结构预测的准确性与主要局限是什么？',
      snapshot: snapshot()
    });

    expect(contract.requiredToolIds).toContain('search_sciverse_evidence');
    expect(contract.sourcePolicy).toBe('sciverse_only');
  });

  it('requires a note read and a line-addressed proposal for current-note edits', () => {
    const contract = compileAssistantExecutionContract({
      question: '把当前 Markdown 笔记第 3 行修改得更准确。',
      snapshot: snapshot({ note: true })
    });

    expect(contract.plan.intent).toBe('note_update');
    expect(contract.plan.editCoordinatePolicy).toBe('line_and_hash');
    expect(contract.requiredToolIds).toEqual(['read_current_note', 'note.propose_patch']);
    expect(contract.plan.target.noteId).toBe('note-1');
  });

  it('does not require workspace tools for ordinary general questions', () => {
    const contract = compileAssistantExecutionContract({
      question: '请解释什么是贝叶斯推断。',
      snapshot: snapshot()
    });

    expect(contract.plan.intent).toBe('general_qa');
    expect(contract.requiredToolIds).toEqual([]);
    expect(contract.failurePolicy).toBe('allow_general_fallback');
  });
});
