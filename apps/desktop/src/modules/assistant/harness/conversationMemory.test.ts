import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage, AssistantConversationMemory, LlmProfile } from '@/shared/ipc/assistantApi';
import { latestConversationMemory, updateConversationMemory } from './conversationMemory';
import { runTextModelTask } from '../sdk/modelTasks';
import { renderConversationContext } from '../runtime/conversationTranscript';
vi.mock('../sdk/modelTasks', () => ({ runTextModelTask: vi.fn() }));
const settings = { max_context_length: 8_000 } as LlmProfile;
const message = (content: string, index: number): ConversationMessage => ({
  content, message_id: 'm' + index, role: index % 2 ? 'assistant' : 'user', created_at: '', source_links: [], parts: []
});
const oldMemory: AssistantConversationMemory = {
  summary: 'EARLIER_MEMORY_SENTINEL', decisions: ['Earlier choice'], entities: [], last_user_goal: null,
  open_items: [], user_preferences: ['Prefer Chinese'], message_count: 2, pending_proposal_count: 0,
  source_count: 1, updated_at: '', retained_context: {
    version: 1, profileId: 'profile', model: 'model', protocol: 'openai_compatible',
    messages: [{ role: 'user', content: 'RETAINED_RECENT_SENTINEL' }, { role: 'assistant', content: 'Recent answer' }]
  }
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runTextModelTask).mockResolvedValue({ text: 'Merged brief.', finishReason: 'stop' });
});
describe('manual full-context summary', () => {
  it('covers the beginning, middle and end of long unsummarized history, not only a fixed tail', async () => {
    const history = Array.from({ length: 24 }, (_, index) => message('TURN_SENTINEL_' + index + ' ' + 'a'.repeat(1_000), index));
    const before = JSON.stringify(history);
    const result = await updateConversationMemory({ history, answer: history[23].content, question: history[22].content,
      settings, pendingProposalCount: 0, sourceCount: 0 });
    const input = vi.mocked(runTextModelTask).mock.calls.map(([call]) => call.system).join('\n');
    for (let index = 0; index < 24; index++) expect(input).toContain('TURN_SENTINEL_' + index);
    expect(vi.mocked(runTextModelTask).mock.calls.length).toBeGreaterThan(1);
    expect(result.retained_context).toBeUndefined();
    expect(JSON.stringify(history)).toBe(before);
  });

  it('includes prior structured memory, its retained tail and every new message exactly once', async () => {
    const checkpoint = { ...message('', 1), parts: [{ type: 'memory' as const, memory: oldMemory }] };
    const history = [message('Already covered raw history', 0), checkpoint, message('NEW_REQUEST_SENTINEL', 2)];
    await updateConversationMemory({ history, question: 'NEW_REQUEST_SENTINEL', answer: '', settings, pendingProposalCount: 0, sourceCount: 1 });
    const input = vi.mocked(runTextModelTask).mock.calls[0][0].system;
    expect(input).toContain('EARLIER_MEMORY_SENTINEL');
    expect(input).toContain('Prefer Chinese');
    expect(input).toContain('RETAINED_RECENT_SENTINEL');
    expect(input.match(/NEW_REQUEST_SENTINEL/g)).toHaveLength(1);
    expect(input).not.toContain('Already covered raw history');
    expect(latestConversationMemory(history)).toBe(oldMemory);
  });

  it('includes complete model-visible tool results when manually compacting', async () => {
    const history = [message('Read note', 0), { ...message('Done', 1), parts: [{
      type: 'model-transcript' as const, transcript: { version: 1 as const, runId: 'run', capturedAt: '', profileId: '',
        model: '', protocol: '', sources: [], messages: [
          { role: 'assistant' as const, content: [{ type: 'tool-call' as const, toolCallId: 'read', toolName: 'read_note', input: {} }] },
          { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: 'read', toolName: 'read_note',
            output: { type: 'text' as const, value: 'TOOL_BEGIN_SENTINEL ' + 'x'.repeat(2_000) + ' TOOL_END_SENTINEL' } }] }
        ] }
    }] }];
    await updateConversationMemory({ history, question: 'Read note', answer: 'Done', settings, pendingProposalCount: 0, sourceCount: 0 });
    const input = vi.mocked(runTextModelTask).mock.calls.map(([call]) => call.system).join('\n');
    expect(input).toContain('TOOL_BEGIN_SENTINEL');
    expect(input).toContain('TOOL_END_SENTINEL');
  });

  it('leaves the existing checkpoint and raw history untouched when a later chunk fails', async () => {
    const history = Array.from({ length: 30 }, (_, index) => message('a'.repeat(1_000), index));
    history.unshift({ ...message('', 1), parts: [{ type: 'memory', memory: oldMemory }] });
    const before = JSON.stringify(history);
    vi.mocked(runTextModelTask).mockResolvedValueOnce({ text: 'First partial summary', finishReason: 'stop' })
      .mockRejectedValue(new Error('summary unavailable'));
    await expect(updateConversationMemory({ history, question: '', answer: '', settings, pendingProposalCount: 0, sourceCount: 0 }))
      .rejects.toThrow('上下文摘要无效');
    expect(JSON.stringify(history)).toBe(before);
    expect(latestConversationMemory(history)).toBe(oldMemory);
  });

  it('automatically retained recent context survives serialization and later requests', () => {
    const checkpoint = { ...message('', 1), parts: [{ type: 'memory' as const, memory: oldMemory }] };
    const disk: ConversationMessage[] = JSON.parse(JSON.stringify([message('Covered prefix', 0), checkpoint, message('NEW_TURN', 2)]));
    const context = JSON.stringify(renderConversationContext(disk));
    expect(context).toContain('EARLIER_MEMORY_SENTINEL');
    expect(context).toContain('RETAINED_RECENT_SENTINEL');
    expect(context).toContain('NEW_TURN');
    expect(context).not.toContain('Covered prefix');
  });
});
