import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import {
  applyMemoryOperations,
  formatMemoryItems,
  memoryListsOf,
  shouldUpdateConversationMemory,
  type MemoryLists
} from './conversationMemory';

const lists = (overrides: Partial<MemoryLists> = {}): MemoryLists => ({
  decisions: [], entities: [], openItems: [], userPreferences: [], ...overrides
});

describe('incremental memory operations', () => {
  it('keeps items the model does not mention', () => {
    const previous = lists({ decisions: ['使用 BM25 排序'], userPreferences: ['回答用中文'] });
    const next = applyMemoryOperations(previous, [{ event: 'ADD', list: 'decisions', text: '工具结果用 MMR 去重' }]);
    expect(next.decisions).toEqual(['使用 BM25 排序', '工具结果用 MMR 去重']);
    expect(next.userPreferences).toEqual(['回答用中文']);
  });

  it('applies UPDATE and DELETE by addressed id', () => {
    const previous = lists({ openItems: ['比较两篇论文的实验设置', '整理相关工作'], entities: ['Transformer'] });
    const next = applyMemoryOperations(previous, [
      { event: 'DELETE', id: 'o1', list: 'openItems' },
      { event: 'UPDATE', id: 'e1', list: 'entities', text: 'Transformer (Vaswani et al., 2017)' },
      { event: 'NONE', id: 'o2', list: 'openItems' }
    ]);
    expect(next.openItems).toEqual(['整理相关工作']);
    expect(next.entities).toEqual(['Transformer (Vaswani et al., 2017)']);
  });

  it('ignores operations on unknown ids except UPDATE text, which becomes an ADD', () => {
    const next = applyMemoryOperations(lists({ decisions: ['A decision'] }), [
      { event: 'DELETE', id: 'd9', list: 'decisions' },
      { event: 'UPDATE', id: 'd9', list: 'decisions', text: 'Another decision' }
    ]);
    expect(next.decisions).toEqual(['A decision', 'Another decision']);
  });

  it('merges near-duplicate ADDs into the existing item', () => {
    const next = applyMemoryOperations(lists({ userPreferences: ['Prefer concise answers in Chinese'] }), [
      { event: 'ADD', list: 'userPreferences', text: 'prefer concise answers in Chinese.' }
    ]);
    expect(next.userPreferences).toEqual(['prefer concise answers in Chinese.']);
  });

  it('evicts the oldest items when a list exceeds its cap', () => {
    const decisions = Array.from({ length: 12 }, (_, index) => `decision number ${index}`);
    const next = applyMemoryOperations(lists({ decisions }), [{ event: 'ADD', list: 'decisions', text: 'newest choice' }]);
    expect(next.decisions).toHaveLength(12);
    expect(next.decisions[0]).toBe('decision number 1');
    expect(next.decisions[next.decisions.length - 1]).toBe('newest choice');
  });

  it('addresses items with stable prefixed ids', () => {
    const formatted = formatMemoryItems(memoryListsOf({ decisions: ['x'], entities: [], open_items: ['y'],
      user_preferences: [], summary: '', last_user_goal: null, message_count: 0, pending_proposal_count: 0,
      source_count: 0, updated_at: '' }));
    expect(formatted).toBe('d1 [decisions] x\no1 [openItems] y');
  });
});

const message = (content: string, memory = false) => ({ content, role: 'assistant',
  parts: memory ? [{ type: 'memory', memory: { summary: 'checkpoint' } }] : [] } as ConversationMessage);
describe('on-demand conversation memory', () => {
  it('does not call a model for short chat', () => {
    expect(shouldUpdateConversationMemory([], '你好', '你好！')).toBe(false);
    expect(shouldUpdateConversationMemory([message('上一句')], '接着聊', '好的')).toBe(false);
  });
  it('summarizes before long uncheckpointed history falls out of the tail', () => {
    expect(shouldUpdateConversationMemory([message('x'.repeat(8_000))], '继续', '回答')).toBe(true);
  });
  it('counts only content since the latest checkpoint, not all old history', () => {
    const history = [message('x'.repeat(20_000)), message('已总结', true), message('你好')];
    expect(shouldUpdateConversationMemory(history, '你好', '你好')).toBe(false);
    expect(shouldUpdateConversationMemory([...history, message('x'.repeat(8_000))], '继续', '回答')).toBe(true);
  });
});
