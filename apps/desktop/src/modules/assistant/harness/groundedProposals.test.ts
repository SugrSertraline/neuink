import { describe, expect, it } from 'vitest';

import { verifyGroundedProposals } from './engine';
import type { AssistantActiveSurfaceSnapshot, AssistantNoteProposal, AssistantContext } from '@/shared/types/assistant';

const browserSurface: AssistantActiveSurfaceSnapshot = { kind: 'browser', entryId: null, noteId: null,
  segmentUid: null, capturedAt: '', pane: 'right', surfaceKey: 'browser:1',
  browserTab: { id: '1', title: 'Page', url: 'https://example.org/page' } };
const webProposal: AssistantNoteProposal = { action: 'create', createdAt: '', entryId: 'notes', entryTitle: 'Notes',
  id: 'proposal-1', markdown: 'Web result. [Source](https://example.org/page)', sources: [], status: 'pending', title: 'Web note' };

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
