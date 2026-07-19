import { describe, expect, it } from 'vitest';

import { modelDrivenBrief, verifyGroundedProposals } from './engine';

describe('modelDrivenBrief', () => {
  it('maps Tag and Entry markers without treating C1/C2 as search text', () => {
    const brief = modelDrivenBrief({
      composerSnapshot: {
        mentions: [
          {
            charOffset: 3, entryId: '', entryTitle: '', id: 'tag:se', kind: 'tag',
            label: '软件工程', marker: '[C1]', tagId: 'se', tagName: '软件工程'
          },
          {
            charOffset: 18, entryId: 'study-notes', entryTitle: '软件工程论文学习',
            id: 'entry:study-notes', kind: 'entry', label: '软件工程论文学习', marker: '[C2]'
          }
        ],
        text: '阅读 [C1] 标签的论文，整理一份笔记到 [C2]'
      },
      contextPlan: {
        editTarget: null,
        items: [],
        summary: 'Context references: 1. Agent decides read/write roles from typed mentions.'
      },
      history: [],
      mentionScope: {
        entry_ids: ['paper-a', 'paper-b'],
        entry_titles: ['Paper A', 'Paper B'],
        tag_ids: ['se'],
        tag_names: ['软件工程']
      }
    });

    expect(brief).toContain('[C1] = TagScope');
    expect(brief).toContain('resolved_entry_ids: ["paper-a","paper-b"]');
    expect(brief).toContain('[C2] = ContextReference { kind: entry, entry_id: study-notes');
    expect(brief).toContain('Never search for literal C1/C2 marker text');
    expect(brief).toContain('note_propose_create');
    expect(brief).toContain('read_entry_assistant_context for each relevant Entry');
  });

  it('replays typed mentions and completed task state for a natural-language resume turn', () => {
    const previousComposer = {
      mentions: [
        {
          charOffset: 3, entryId: '', entryTitle: '', id: 'tag:se', kind: 'tag' as const,
          label: '软件工程', marker: '[C1]', tagId: 'se', tagName: '软件工程'
        },
        {
          charOffset: 18, entryId: 'study-notes', entryTitle: '软件工程论文学习',
          id: 'entry:study-notes', kind: 'entry' as const, label: '软件工程论文学习', marker: '[C2]'
        }
      ],
      text: '阅读 [C1] 标签的论文，整理一份笔记到 [C2]'
    };
    const brief = modelDrivenBrief({
      composerSnapshot: { mentions: [], text: '恢复任务' },
      history: [
        {
          content: previousComposer.text, created_at: '', message_id: 'user-1', role: 'user',
          source_links: [], parts: [{ composer: previousComposer, items: [], type: 'context-snapshot' }]
        },
        {
          content: '无法完成', created_at: '', message_id: 'assistant-1', role: 'assistant',
          source_links: [], parts: [{
            type: 'task-state', task: completedTask(previousComposer.text)
          }]
        }
      ],
      mentionScope: {
        entry_ids: ['paper-a', 'study-notes'], entry_titles: ['Paper A', '软件工程论文学习'],
        tag_ids: ['se'], tag_names: ['软件工程']
      }
    });

    expect(brief).toContain('Historical Typed Mention Maps available for continuation');
    expect(brief).toContain('[C1] = TagScope');
    expect(brief).toContain('[C2] = ContextReference');
    expect(brief).toContain('Previous task state: status=completed');
    expect(brief).toContain('阅读 [C1] 标签的论文');
  });
});

describe('verifyGroundedProposals', () => {
  it('rejects an uncited note when a Tag mention defines the paper source scope', () => {
    expect(() => verifyGroundedProposals({
      composerSnapshot: {
        mentions: [{
          charOffset: 3, entryId: '', entryTitle: '', id: 'tag:se', kind: 'tag',
          label: '软件工程', marker: '[C1]', tagId: 'se', tagName: '软件工程'
        }],
        text: '阅读 [C1] 标签的论文，整理一份笔记到 [C2]'
      },
      proposals: [{
        action: 'create', createdAt: '', entryId: 'study-notes', entryTitle: '学习',
        id: 'proposal-1', markdown: 'No citation', noteId: null, sources: [],
        status: 'pending', title: '学习笔记'
      }],
      sources: []
    })).toThrow('without a valid source citation');
  });
});

function completedTask(goal: string) {
  return {
    conversationId: 'conversation-1', createdAt: '', evidenceLedger: {
      createdAt: '', evidence: [], ledgerId: 'ledger-1', taskId: 'task-1', updatedAt: ''
    },
    goal: { normalizedGoal: goal, originalRequest: goal }, operation: null,
    phase: 'verify' as const, proposalIds: [], revision: 1,
    spec: {
      attachments: [], capabilities: [], confidence: 1, deliverables: ['chat_answer' as const],
      intent: 'general_qa' as const, missing: [], needsCurrentNote: false,
      needsDocumentContext: false, needsNoteProposal: false, needsSegmentSearch: false,
      rationale: '', steps: [], target: { kind: 'chat_only' as const }
    },
    status: 'completed' as const, taskId: 'task-1', updatedAt: ''
  };
}
