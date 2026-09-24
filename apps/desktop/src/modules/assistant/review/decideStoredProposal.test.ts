import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConversation, type Conversation } from '@/shared/ipc/assistantApi';
import { decideAssistantProposal } from '@/shared/ipc/assistantProposalApi';
import { decideStoredProposal } from './decideStoredProposal';
import type { AssistantTagProposal } from '@/shared/types/assistant';
vi.mock('@/shared/ipc/assistantApi', () => ({ loadConversation: vi.fn() }));
vi.mock('@/shared/ipc/assistantProposalApi', () => ({ decideAssistantProposal: vi.fn() }));
const proposal: AssistantTagProposal = { action: 'create', createdAt: '', entryIds: [], id: 'p', name: 'Tag', status: 'pending' };
const saved = { id: 'original', messages: [{ message_id: 'm', parts: [{ type: 'tag-proposal', proposal }] }] } as Conversation;
beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadConversation).mockResolvedValue(structuredClone(saved)); });
function options() { return { root: 'root', conversationId: 'original', proposal, decision: 'apply' as const, apply: vi.fn(async () => {}), onConversation: vi.fn() }; }
describe('stored proposal decisions', () => {
  it('requires the exact saved pending payload before calling the business mutation', async () => {
    const opts = options();
    await decideStoredProposal(opts);
    expect(opts.apply).toHaveBeenCalledExactlyOnceWith({ conversationId: 'original', messageId: 'm' });
    expect(opts.onConversation).toHaveBeenLastCalledWith(saved);
  });
  it('refuses changed payloads, already processed proposals and storage failures', async () => {
    const opts = options();
    await expect(decideStoredProposal({ ...opts, proposal: { ...proposal, name: 'Different' } })).rejects.toThrow('提案已变化');
    const processed = structuredClone(saved);
    (processed.messages[0].parts![0] as { proposal: AssistantTagProposal }).proposal.status = 'applied';
    vi.mocked(loadConversation).mockResolvedValue(processed);
    await expect(decideStoredProposal(opts)).rejects.toThrow('提案已变化');
    vi.mocked(loadConversation).mockRejectedValue(new Error('disk unavailable'));
    await expect(decideStoredProposal(opts)).rejects.toThrow('disk unavailable');
    expect(opts.apply).not.toHaveBeenCalled();
  });
  it('locks synchronously against double clicks or an opposite decision', async () => {
    const opts = options();
    let finish!: () => void;
    opts.apply.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = decideStoredProposal(opts);
    await vi.waitFor(() => expect(opts.apply).toHaveBeenCalledOnce());
    await decideStoredProposal(opts);
    await decideStoredProposal({ ...opts, decision: 'reject' });
    expect(decideAssistantProposal).not.toHaveBeenCalled();
    finish(); await pending;
    expect(opts.apply).toHaveBeenCalledOnce();
  });
  it('persists rejection without invoking the write callback', async () => {
    const opts = options();
    await decideStoredProposal({ ...opts, decision: 'reject' });
    expect(opts.apply).not.toHaveBeenCalled();
    expect(decideAssistantProposal).toHaveBeenCalledExactlyOnceWith('root', proposal, { conversationId: 'original', messageId: 'm' }, 'reject');
  });
  it('refreshes an ambiguous submission without retrying the mutation', async () => {
    const opts = options();
    opts.apply.mockRejectedValue(new Error('connection lost'));
    await expect(decideStoredProposal(opts)).rejects.toThrow('connection lost');
    expect(opts.apply).toHaveBeenCalledOnce();
    expect(opts.onConversation).toHaveBeenCalledWith(saved);
  });
});
