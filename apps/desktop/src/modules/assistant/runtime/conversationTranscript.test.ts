import { describe, expect, it } from 'vitest';
import type { AssistantConversationMemory, ConversationMessage } from '@/shared/ipc/assistantApi';
import { renderConversationTranscript } from './conversationTranscript';
const memory: AssistantConversationMemory = {
  decisions: [], entities: [], last_user_goal: 'compare', message_count: 4, open_items: [],
  pending_proposal_count: 0, source_count: 2, summary: 'Compared two papers.', updated_at: '',
  user_preferences: []
};
const message = (role: 'user' | 'assistant', content: string, checkpoint = false): ConversationMessage => ({
  content, created_at: '', message_id: `${role}-${content}`,
  parts: checkpoint ? [{ memory, type: 'memory' }] : [], role, source_links: []
});
describe('conversation transcript', () => {
  it('renders real turns, strips stale markers and never starts on an assistant turn', () => {
    expect(renderConversationTranscript([
      message('assistant', 'Earlier answer [S4].'),
      message('user', 'Compare them [S1].'),
      message('assistant', 'Both agree.')
    ])).toEqual([
      { role: 'user', content: 'Compare them .' },
      { role: 'assistant', content: 'Both agree.' }
    ]);
  });
  it('drops turns with no text and keeps opposite roles separate', () => {
    expect(renderConversationTranscript([
      message('user', 'First'),
      message('assistant', ''),
      message('assistant', 'Second')
    ])).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' }
    ]);
  });
  it('merges consecutive turns of the same role', () => {
    expect(renderConversationTranscript([
      message('user', 'First'),
      message('user', 'Second'),
      message('assistant', 'Answer')
    ])).toEqual([
      { role: 'user', content: 'First\n\nSecond' },
      { role: 'assistant', content: 'Answer' }
    ]);
  });
  it('starts after the last memory checkpoint, so a compacted history is not sent twice', () => {
    expect(renderConversationTranscript([
      message('user', 'Old question'),
      message('assistant', 'Old answer', true),
      message('user', 'New question')
    ])).toEqual([{ role: 'user', content: 'New question' }]);
  });
  it('keeps the whole history once a later message supersedes the checkpoint', () => {
    expect(renderConversationTranscript([
      message('assistant', 'Old answer', true),
      message('user', 'New question'),
      message('assistant', 'New answer')
    ])).toEqual([
      { role: 'user', content: 'New question' },
      { role: 'assistant', content: 'New answer' }
    ]);
  });
});
