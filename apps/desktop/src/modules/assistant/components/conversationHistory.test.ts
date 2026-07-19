import { describe, expect, it } from 'vitest';

import type { ConversationMeta } from '@/shared/ipc/assistantApi';

import { visibleConversationHistory } from './conversationHistory';

function conversation(id: string, messageCount: number, entryIds: string[]): ConversationMeta {
  return {
    context_items: [],
    created_at: '2026-07-14T00:00:00Z',
    id,
    message_count: messageCount,
    scope_snapshot: {
      entry_ids: entryIds,
      entry_titles: entryIds,
      tag_ids: [],
      tag_names: []
    },
    title: id,
    updated_at: '2026-07-14T00:00:00Z'
  };
}

describe('conversation history', () => {
  it('hides empty conversations while preserving list order', () => {
    const conversations = [
      conversation('empty', 0, ['entry-1']),
      conversation('first', 2, ['entry-1']),
      conversation('second', 4, ['entry-2'])
    ];

    expect(visibleConversationHistory(conversations).map((item) => item.id)).toEqual([
      'first',
      'second'
    ]);
  });
});
