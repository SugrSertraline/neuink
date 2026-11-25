import { describe, expect, it } from 'vitest';
import type { AssistantConversationMemory, ConversationMessage } from '@/shared/ipc/assistantApi';
import { lastMemoryCheckpointIndex, renderConversationContext, renderConversationTranscript } from './conversationTranscript';
import { recordedTurn } from '../sdk/testHelpers/conversation';

const memory: AssistantConversationMemory = {
  decisions: [], entities: [], last_user_goal: 'compare', message_count: 4, open_items: [],
  pending_proposal_count: 0, source_count: 2, summary: 'Compared two papers.', updated_at: '', user_preferences: []
};
const checkpoint = (value = memory): ConversationMessage => ({
  content: '', created_at: '', message_id: 'checkpoint', role: 'assistant', source_links: [],
  parts: [{ type: 'memory', memory: value }]
});

describe('current conversation transcript', () => {
  it('replays saved inputs and outputs rather than UI text or citation labels', () => {
    const history = recordedTurn('Actual question [S7]', 'Actual answer [S7]', 0);
    history[0].content = 'UI question';
    history[1].content = 'UI answer [S1]';
    expect(renderConversationTranscript(history)).toEqual([
      { role: 'user', content: 'Actual question [S7]' }, { role: 'assistant', content: 'Actual answer [S7]' }
    ]);
  });

  it('does not reconstruct plain-text messages or unfinished UI placeholders', () => {
    const history = recordedTurn('Question', 'Answer', 0).map(message => ({ ...message, parts: [] }));
    expect(renderConversationTranscript(history)).toEqual([]);
  });

  it('preserves consecutive saved input messages exactly', () => {
    const history = recordedTurn('First', 'Answer', 0);
    const part = history[1].parts![0];
    if (part.type !== 'model-transcript') throw new Error('Missing fixture transcript');
    part.transcript.inputMessages.push({ role: 'user', content: 'Second' });
    expect(renderConversationTranscript(history)).toEqual([
      { role: 'user', content: 'First' }, { role: 'user', content: 'Second' }, { role: 'assistant', content: 'Answer' }
    ]);
  });

  it('starts after the latest checkpoint and can rebuild original records for manual compaction', () => {
    const history = [...recordedTurn('Old question', 'Old answer', 0), checkpoint(), ...recordedTurn('New question', 'New answer', 1)];
    expect(renderConversationTranscript(history)).toEqual([
      { role: 'user', content: 'New question' }, { role: 'assistant', content: 'New answer' }
    ]);
    expect(renderConversationTranscript(history, undefined, { includeSummarized: true })).toHaveLength(4);
  });

  it('replays a current retained suffix after the summary, before later inputs', () => {
    const saved = { ...memory, retained_context: { version: 2 as const, profileId: 'profile', model: 'model', protocol: 'openai_compatible',
      messages: [{ role: 'assistant' as const, content: 'Retained answer' }] } };
    const context = renderConversationContext([checkpoint(saved), ...recordedTurn('Next', 'New answer', 1)]);
    expect(context.slice(1)).toEqual([
      { role: 'assistant', content: 'Retained answer' }, { role: 'user', content: 'Next' }, { role: 'assistant', content: 'New answer' }
    ]);
  });

  it('does not accept an old retained suffix or let it hide current archived messages', () => {
    const saved = { ...memory, retained_context: { version: 1 as 2, profileId: '', model: '', protocol: '',
      messages: [{ role: 'user' as const, content: 'OLD_FORMAT_MUST_NOT_REPLAY' }] } };
    const history = [...recordedTurn('Actual question', 'Actual answer', 0), checkpoint(saved)];
    expect(lastMemoryCheckpointIndex(history)).toBe(-1);
    expect(renderConversationTranscript(history)).toEqual([
      { role: 'user', content: 'Actual question' }, { role: 'assistant', content: 'Actual answer' }
    ]);
  });
});
