import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import { shouldUpdateConversationMemory } from './conversationMemory';

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
