import { describe, expect, it } from 'vitest';

import type { AssistantContextItem } from '@/shared/types/assistant';
import { planAssistantContext } from './contextPlanner';

describe('planAssistantContext', () => {
  it('never assigns semantic write roles with UI regexes', () => {
    const destination = entry('study-notes', '软件工程论文学习');
    const plan = planAssistantContext({
      composerSnapshot: {
        mentions: [{
          charOffset: 18, entryId: destination.entryId, entryTitle: destination.entryTitle,
          id: destination.id, kind: 'entry', label: destination.entryTitle,
          marker: '[C2]'
        }],
        text: '整理一份笔记到 [C2]'
      },
      items: [destination],
      question: '整理一份笔记到 [C2]'
    });

    expect(plan?.editTarget).toBeNull();
    expect(plan?.items[0].role).toBe('read');
    expect(plan?.summary).toContain('Agent decides read/write roles');
  });

  it('counts Tag mentions even though Tags are scope references, not document attachments', () => {
    const plan = planAssistantContext({
      composerSnapshot: {
        mentions: [{
          charOffset: 3, entryId: '', entryTitle: '', id: 'tag:se', kind: 'tag',
          label: '软件工程', marker: '[C1]', tagId: 'se', tagName: '软件工程'
        }],
        text: '阅读 [C1] 标签的论文'
      },
      items: [],
      question: '阅读 [C1] 标签的论文'
    });

    expect(plan?.items).toEqual([]);
    expect(plan?.summary).toContain('Context references: 1');
  });

  it('keeps Segments as deterministic evidence attachments', () => {
    const plan = planAssistantContext({
      items: [segment('s1')],
      question: '使用这个片段'
    });
    expect(plan?.items[0]).toMatchObject({ role: 'evidence', segmentUid: 's1' });
  });
});

function entry(id: string, title: string): AssistantContextItem {
  return { addedAt: '', entryId: id, entryTitle: title, id: `entry:${id}`, kind: 'entry' };
}

function segment(uid: string): AssistantContextItem {
  return {
    addedAt: '', entryId: 'e1', entryTitle: 'Paper', id: `segment:e1:${uid}`,
    kind: 'segment', pageIdx: 0, segmentUid: uid, text: `segment ${uid}`
  };
}
