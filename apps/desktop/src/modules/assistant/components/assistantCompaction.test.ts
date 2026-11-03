// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AssistantConversationMemory,
  Conversation,
  ConversationMessage
} from '@/shared/ipc/assistantApi';
import { appendConversationMessages } from '@/shared/ipc/assistantApi';
import { updateConversationMemory } from '../harness/conversationMemory';
import {
  canCompactConversation,
  compactConversation,
  compactionCheckpointMessage,
  compactionInputs
} from './assistantCompaction';

vi.mock('@/shared/ipc/assistantApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ipc/assistantApi')>()),
  appendConversationMessages: vi.fn()
}));
vi.mock('../harness/conversationMemory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../harness/conversationMemory')>()),
  updateConversationMemory: vi.fn()
}));

const memory: AssistantConversationMemory = {
  decisions: [], entities: [], last_user_goal: 'compare', message_count: 4, open_items: [],
  pending_proposal_count: 1, source_count: 1, summary: 'Compared two papers.', updated_at: '',
  user_preferences: []
};

const message = (
  role: ConversationMessage['role'], content: string, extra: Partial<ConversationMessage> = {}
): ConversationMessage => ({
  content, created_at: '', message_id: `${role}-${content}`, parts: [], role, source_links: [], ...extra
});

const conversation = (messages: ConversationMessage[]): Conversation => ({
  created_at: '', id: 'conversation', messages, scope_snapshot: {} as Conversation['scope_snapshot'],
  title: 'Compare papers', updated_at: ''
});

beforeEach(() => vi.clearAllMocks());

describe('manual compaction inputs', () => {
  it('takes the newest request and outcome and counts real sources and pending proposals', () => {
    const history = [
      message('user', 'First question'),
      message('assistant', 'First answer', { source_links: [{ provider: 'entry', entryId: 'a', title: 'A' } as never] }),
      message('user', 'Second question'),
      message('assistant', 'Second answer', {
        note_proposals: [
          { id: 'p1', status: 'pending' } as never,
          { id: 'p2', status: 'applied' } as never
        ],
        source_links: [{ provider: 'entry', entryId: 'a', title: 'A' } as never]
      })
    ];
    expect(compactionInputs(history)).toEqual({
      answer: 'Second answer',
      pendingProposalCount: 1,
      question: 'Second question',
      sourceCount: 1
    });
  });
});

describe('compaction eligibility', () => {
  it('resets what the next automatic checkpoint would have to cover', () => {
    const history = [message('user', 'A'.repeat(5_000)), message('assistant', 'B'.repeat(5_000))];
    expect(canCompactConversation(history)).toBe(true);
    // The appended payload is what IPC fills in an id, a timestamp and source links for.
    const compacted = [...history, { ...compactionCheckpointMessage(memory), created_at: '', message_id: 'checkpoint', source_links: [] }];
    expect(canCompactConversation(compacted)).toBe(false);
  });

  it('needs real turns after the newest checkpoint', () => {
    expect(canCompactConversation([])).toBe(false);
    expect(canCompactConversation([message('user', 'Hello')])).toBe(true);
    expect(canCompactConversation([
      message('assistant', '', { parts: [{ memory, type: 'memory' }] })
    ])).toBe(false);
    expect(canCompactConversation([
      message('user', 'Old question'),
      message('assistant', '', { parts: [{ memory, type: 'memory' }] })
    ])).toBe(false);
    expect(canCompactConversation([
      message('assistant', '', { parts: [{ memory, type: 'memory' }] }),
      message('user', 'New question')
    ])).toBe(true);
  });

  it('allows manually compacting an automatically retained tail even without a newer chat message', () => {
    const automatic = { ...memory, retained_context: { version: 1 as const, profileId: '', model: '', protocol: '',
      messages: [{ role: 'user' as const, content: 'Recent uncompressed request' }] } };
    expect(canCompactConversation([message('assistant', '', { parts: [{ type: 'memory', memory: automatic }] })])).toBe(true);
  });
});

describe('manual compaction', () => {
  it('appends one memory-only checkpoint and keeps every original message', async () => {
    vi.mocked(updateConversationMemory).mockResolvedValue(memory);
    const history = [message('user', 'Compare them'), message('assistant', 'Done')];
    vi.mocked(appendConversationMessages).mockResolvedValue(conversation([...history]));

    await compactConversation({
      conversation: conversation(history), root: 'root', settings: {} as never
    });

    expect(vi.mocked(updateConversationMemory).mock.calls[0][0]).toMatchObject({
      answer: 'Done', history, pendingProposalCount: 0, question: 'Compare them', sourceCount: 0
    });
    const [, , appended] = vi.mocked(appendConversationMessages).mock.calls[0];
    expect(appended).toEqual([compactionCheckpointMessage(memory)]);
    expect(appended[0].content).toBe('');
    expect(appended[0].parts).toEqual([{ memory, type: 'memory' }]);
  });

  it('writes nothing when the summary fails', async () => {
    vi.mocked(updateConversationMemory).mockRejectedValue(new Error('model offline'));
    await expect(compactConversation({
      conversation: conversation([message('user', 'Compare them')]), root: 'root', settings: {} as never
    })).rejects.toThrow('model offline');
    expect(appendConversationMessages).not.toHaveBeenCalled();
  });
});
