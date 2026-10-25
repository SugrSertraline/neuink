import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/shared/ipc/assistantApi';
import { conversationLocalSession, createLocalSession, localAgentProfile, selectionLocalProvider } from './session';
const ready = {type:'local-agent',provider:'claude',sessionId:'550e8400-e29b-41d4-a716-446655440000',initialized:true} as const;
describe('conversation-bound local sessions', () => {
  it('uses official names and never reuses a session across providers',()=>{
    expect(localAgentProfile('claude').name).toBe('Claude Code');
    expect(localAgentProfile('codex').name).toBe('Codex');
    expect(localAgentProfile('opencode').name).toBe('OpenCode');
    expect(selectionLocalProvider('local-agent:codex')).toBe('codex');
    expect(selectionLocalProvider('local-agent:unknown')).toBeNull();
    const conversation={messages:[{parts:[{...ready,provider:'codex',sessionId:'thread_123'}]}]} as unknown as Conversation;
    expect(conversationLocalSession(conversation)?.provider).toBe('codex');
    expect(createLocalSession(conversation,'codex').sessionId).toBe('thread_123');
    expect(createLocalSession(conversation,'opencode').sessionId).not.toBe('thread_123');
  });
  it('creates a new identity per conversation and never infers Claude from model text', () => {
    expect(conversationLocalSession(null)).toBeNull();
    const a = createLocalSession(null), b = createLocalSession(null);
    expect(a.sessionId).not.toBe(b.sessionId); expect(a.initialized).toBe(false);
  });
  it('resumes the initialized identity even after an incomplete retry', () => {
    const conversation = {messages:[{parts:[ready]},{parts:[{...ready,initialized:false}]}]} as unknown as Conversation;
    expect(conversationLocalSession(conversation)).toEqual(ready);
    expect(createLocalSession(conversation)).toEqual(ready);
  });
});
