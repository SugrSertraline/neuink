import { describe, expect, it } from 'vitest';

import type { AssistantContextItem } from '@/shared/types/assistant';

import {
  externalAssistantContextItems,
  hasPersistableAssistantContext,
  orderedAssistantContextItems
} from './assistantComposerBlocks';

describe('orderedAssistantContextItems', () => {
  it('follows inline mention order, removes duplicates, then keeps external context', () => {
    const items = [entry('external'), entry('second'), entry('first')];
    const result = orderedAssistantContextItems(items, {
      mentions: [mention('first', '[C1]'), mention('second', '[C2]'), mention('first', '[C3]')],
      text: '[C1] compare [C2] with [C3]'
    });

    expect(result.map((item) => item.entryId)).toEqual(['first', 'second', 'external']);
  });
});

describe('hasPersistableAssistantContext', () => {
  it('persists a Tag-only composer snapshot for later continuation', () => {
    expect(hasPersistableAssistantContext([], {
      mentions: [{
        charOffset: 3, entryId: '', entryTitle: '', id: 'tag:se', kind: 'tag',
        label: '软件工程', marker: '[C1]', tagId: 'se', tagName: '软件工程'
      }],
      text: '阅读 [C1] 标签的论文'
    })).toBe(true);
  });
});

describe('externalAssistantContextItems', () => {
  it('keeps a restored inline Entry in the composer instead of moving it to external context', () => {
    const items = [entry('paper')];

    expect(
      externalAssistantContextItems(items, {
        mentions: [mention('paper', '[C1]')],
        text: 'Compare [C1] with the current result'
      })
    ).toEqual([]);
  });
});

function entry(entryId: string): AssistantContextItem {
  return {
    addedAt: '', entryId, entryTitle: entryId, id: `entry:${entryId}`, kind: 'entry'
  };
}

function mention(entryId: string, marker: string) {
  return {
    charOffset: 0,
    entryId,
    entryTitle: entryId,
    id: `entry:${entryId}`,
    kind: 'entry' as const,
    label: entryId,
    marker
  };
}
