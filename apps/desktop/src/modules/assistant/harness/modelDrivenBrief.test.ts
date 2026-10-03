import { describe, expect, it } from 'vitest';

import { modelDrivenBrief, verifyGroundedProposals } from './engine';
import type { AssistantActiveSurfaceSnapshot, AssistantNoteProposal, AssistantContext } from '@/shared/types/assistant';

const browserSurface: AssistantActiveSurfaceSnapshot = { kind: 'browser', entryId: null, noteId: null,
  segmentUid: null, capturedAt: '', pane: 'right', surfaceKey: 'browser:1',
  browserTab: { id: '1', title: 'Page', url: 'https://example.org/page' } };
const webProposal: AssistantNoteProposal = { action: 'create', createdAt: '', entryId: 'notes', entryTitle: 'Notes',
  id: 'proposal-1', markdown: 'Web result. [Source](https://example.org/page)', sources: [], status: 'pending', title: 'Web note' };

describe('modelDrivenBrief', () => {
  it('marks historical paper references as prior context while retaining current evidence obligations for browser tasks', () => {
    const brief = modelDrivenBrief({ currentSurface: browserSurface, history: [],
      mentionScope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } });
    expect(brief).toContain('Historical paper mentions below describe prior requests');
    expect(brief).toContain('Current explicit paper, tag and excerpt attachments still apply');
  });
  it('carries the exact host-rendered diagram into a follow-up note request', () => {
    const brief = modelDrivenBrief({
      history: [{ message_id: 'diagram', role: 'assistant', content: '已整理', created_at: '', source_links: [],
        parts: [{ type: 'tool-result', id: 'diagram-1', toolName: 'present_diagram', summary: '已生成',
          diagram: { kind: 'mindmap', title: '关系图', code: 'mindmap\n  root["关系"]', sourceMarkers: [] } }] }],
      mentionScope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }
    });
    expect(brief).toContain('Previous host-rendered diagram');
    expect(brief).toContain('mindmap\n  root["关系"]');
    expect(brief).toContain('read the selected destination note');
  });
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
  it.each<AssistantContext>([
    { items: [{ kind: 'entry', contentKind: 'pdf', id: 'attachment', entryId: 'paper', entryTitle: 'Paper', addedAt: '' }] },
    { items: [{ kind: 'segment', id: 'attachment', entryId: 'paper', entryTitle: 'Paper', addedAt: '', text: 'Evidence', pageIdx: 0, segmentUid: 's1' }] }
  ])('preserves attached current document or selection evidence with a browser target', assistantContext => {
    expect(() => verifyGroundedProposals({ currentSurface: browserSurface, assistantContext,
      proposals: [webProposal], sources: [] })).toThrow('without a valid source citation');
  });

  it('preserves current planned evidence and any sources read during a browser task', () => {
    expect(() => verifyGroundedProposals({ currentSurface: browserSurface, proposals: [webProposal], sources: [],
      contextPlan: { summary: '', items: [{ attachmentId: 'paper', entryId: 'paper', entryTitle: 'Paper',
        hydration: 'search_first', kind: 'pdf', reason: 'Selected evidence', role: 'evidence' }] }
    })).toThrow('without a valid source citation');
    expect(() => verifyGroundedProposals({ currentSurface: browserSurface, proposals: [webProposal],
      sources: [{ entry_id: 'paper', entry_title: 'Paper', page_idx: 0, segment_uid: 's1', quote: 'Evidence' }]
    })).toThrow('without a valid source citation');
  });

  it('retains historical grounding for nonbrowser continuations and ignores only historical references for a captured browser target', () => {
    const history = [{ message_id: 'old', role: 'user' as const, content: 'Read [C1]', created_at: '', source_links: [],
      parts: [{ type: 'context-snapshot' as const, items: [], composer: { text: 'Read [C1]', mentions: [{
        charOffset: 0, entryId: 'paper', entryTitle: 'Paper', id: 'pdf', kind: 'pdf' as const, label: 'Paper', marker: '[C1]'
      }] } }] }];
    const input = { history, proposals: [webProposal], sources: [] };
    expect(() => verifyGroundedProposals(input)).toThrow('without a valid source citation');
    expect(() => verifyGroundedProposals({ ...input, currentSurface: browserSurface })).not.toThrow();
    expect(() => verifyGroundedProposals({ ...input, currentSurface: { ...browserSurface, browserTab: undefined } }))
      .toThrow('without a valid source citation');
  });
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
