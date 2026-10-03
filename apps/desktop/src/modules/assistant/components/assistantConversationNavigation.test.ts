import { expect, it, vi } from 'vitest';
import { requestOpenAssistantConversation, subscribeAssistantConversationNavigation } from './assistantConversationNavigation';

it('holds a task navigation while the panel is unmounted and only consumes it in its own workspace', () => {
  requestOpenAssistantConversation('A', 'conversation-1');
  const wrong = vi.fn(), correct = vi.fn();
  const offWrong = subscribeAssistantConversationNavigation('B', wrong);
  expect(wrong).not.toHaveBeenCalled();
  const offCorrect = subscribeAssistantConversationNavigation('A', correct);
  expect(correct).toHaveBeenCalledExactlyOnceWith({ root: 'A', conversationId: 'conversation-1' });
  offCorrect(); offWrong();
  const mountedAgain = vi.fn();
  const offAgain = subscribeAssistantConversationNavigation('A', mountedAgain);
  expect(mountedAgain).not.toHaveBeenCalled();
  offAgain();
});

it('delivers a new task navigation to mounted subscribers and releases listeners on unmount', () => {
  const first = vi.fn(), second = vi.fn();
  const offFirst = subscribeAssistantConversationNavigation('A', first);
  const offSecond = subscribeAssistantConversationNavigation('A', second);
  requestOpenAssistantConversation('A', 'conversation-2');
  expect(first).toHaveBeenCalledExactlyOnceWith({ root: 'A', conversationId: 'conversation-2' });
  expect(second).toHaveBeenCalledExactlyOnceWith({ root: 'A', conversationId: 'conversation-2' });
  offFirst(); offSecond();
  requestOpenAssistantConversation('A', 'conversation-3');
  expect(first).toHaveBeenCalledOnce();
  const releasePending = subscribeAssistantConversationNavigation('A', () => {}); releasePending();
});
