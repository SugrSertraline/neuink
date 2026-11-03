import { describe, expect, it } from 'vitest';
import type {
  AssistantConversationMemory,
  ConversationMessage,
  LlmProfile
} from '@/shared/ipc/assistantApi';
import { analyzeConversationLength, conversationContextWindow } from './assistantPanelState';

const profile = { max_context_length: 128_000 } as LlmProfile;
const memory: AssistantConversationMemory = {
  decisions: [], entities: [], last_user_goal: null, message_count: 2, open_items: [],
  pending_proposal_count: 0, source_count: 0, summary: 'Summarized.', updated_at: '',
  user_preferences: []
};
const message = (
  role: ConversationMessage['role'], content: string, parts: ConversationMessage['parts'] = []
): ConversationMessage => ({
  content, created_at: '', message_id: `${role}-${content.length}`, parts, role, source_links: []
});
const checkpoint = message('assistant', '', [{ memory, type: 'memory' }]);

describe('conversation usage estimate', () => {
  it('calibrates the displayed window with real usage from the selected model', () => {
    const selected = { ...profile, id: 'profile', model: 'model' } as LlmProfile;
    const history = [message('user', '中'.repeat(1_000)), message('assistant', 'Answer', [{ type: 'model-transcript', transcript: {
      version: 1, runId: 'run', capturedAt: '', profileId: 'profile', model: 'model', protocol: 'openai_compatible', sources: [],
      messages: [{ role: 'assistant', content: 'Answer' }],
      contextUsage: { version: 1, inputTokens: 1_000, estimatedInputTokens: 2_000, overheadTokens: 100, messageTokens: 1_900 }
    } }])];
    const usage = analyzeConversationLength(history, selected);
    expect(usage.estimatedTokens).toBeLessThan(1_000);
    expect(usage.estimatedTokens).toBeGreaterThan(750);
    expect(analyzeConversationLength(history, { ...selected, id: 'other-model' }).estimatedTokens).toBeGreaterThan(1_500);
  });
  it('counts actual model results once and does not count UI evidence ledgers as replayed messages', () => {
    const prose = [message('user', 'Question'), message('assistant', 'Answer')];
    const decorated = structuredClone(prose);
    decorated[1].parts = [{ type: 'task-state', task: { evidenceLedger: { evidence: [{ quote: '中'.repeat(80_000) }] } } } as never];
    expect(analyzeConversationLength(decorated, profile).estimatedTokens).toBe(analyzeConversationLength(prose, profile).estimatedTokens);
    decorated[1].parts.push({ type: 'model-transcript', transcript: {
      version: 1, runId: 'run', capturedAt: '', profileId: '', model: '', protocol: '', sources: [], messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'read', input: {} }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c', toolName: 'read', output: { type: 'text', value: '中'.repeat(1_000) } }] },
        { role: 'assistant', content: 'Answer' }
      ]
    } });
    const tokens = analyzeConversationLength(decorated, profile).estimatedTokens;
    expect(tokens).toBeGreaterThan(1_500);
    expect(tokens).toBeLessThan(2_000);
  });
  it('counts Chinese text at the provider rate instead of a quarter of it', () => {
    // 1000 ideographs are roughly 1500 tokens; chars / 4 would report 250 and never warn.
    const usage = analyzeConversationLength([message('user', '中'.repeat(1_000))], profile);
    expect(usage.estimatedTokens).toBe(1_504);
    expect(usage.modelKiloTokens).toBe(128);
    expect(usage.nearingAutoCompaction).toBe(false);
  });

  it('marks the automatic compaction point at 90% of the window', () => {
    const usage = analyzeConversationLength([message('user', '中'.repeat(80_000))], profile);
    expect(usage.usageRatio).toBeGreaterThan(0.9);
    expect(usage.nearingAutoCompaction).toBe(true);
    expect(usage.isLong).toBe(true);
  });

  it('measures only what the next request sends, from the newest checkpoint on', () => {
    const history = [message('user', '中'.repeat(80_000)), message('user', 'Keep going'), checkpoint];
    expect(conversationContextWindow(history)).toEqual([checkpoint]);
    const usage = analyzeConversationLength(history, profile);
    expect(usage.memoryActive).toBe(true);
    expect(usage.nearingAutoCompaction).toBe(false);
    expect(usage.isLong).toBe(false);
    // The whole conversation is still reported, so the history itself is never hidden.
    expect(usage.messageCount).toBe(3);
  });
});
