// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AssistantReplyReader } from './AssistantReplyReader';
import { AssistantReplyActionsContext } from './AssistantReplyActionsContext';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';

afterEach(cleanup);
it('renders full Markdown with working citations without nesting a dialog or another expand button', () => {
  const message: ConversationMessage = { message_id: 'reply', role: 'assistant', content: '完整内容 [S1]', created_at: '',
    source_links: [{ entry_id: 'entry', entry_title: '论文', page_idx: 1, segment_uid: 'seg', quote: '原文' }] };
  const openSource = vi.fn();
  const view = render(<AssistantReplyActionsContext.Provider value={{ root: 'r', openReply: vi.fn(), openSource, addSciverseSource: vi.fn() }}>
    <AssistantReplyReader message={message} /></AssistantReplyActionsContext.Provider>);
  expect(view.getByRole('region', { name: '完整回复' })).toBeTruthy();
  expect(view.getByText('只读')).toBeTruthy();
  expect(view.queryByRole('dialog')).toBeNull();
  expect(view.queryByRole('button', { name: '展开阅读' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /S1/ }));
  expect(openSource).toHaveBeenCalledWith(message.source_links[0], { replyId: 'reply' });
});

it.each(['left', 'right'])('keeps the citation button alive when pointer-down focuses the %s reading pane', pane => {
  const message: ConversationMessage = { message_id: 'reply', role: 'assistant', content: '证据 [S1]', created_at: '',
    source_links: [{ entry_id: 'entry', entry_title: '论文', page_idx: 1, segment_uid: 'seg', quote: '原文' }] };
  const openSource = vi.fn();
  function Host() {
    const [focused, setFocused] = useState(false);
    return <AssistantReplyActionsContext.Provider value={{ root: 'r', openReply: vi.fn(),
      openSource: (source, options) => openSource(source, options, focused), addSciverseSource: vi.fn() }}>
      <div data-pane={pane} onPointerDown={() => setFocused(true)}><AssistantReplyReader message={message} /></div>
    </AssistantReplyActionsContext.Provider>;
  }
  const view = render(<Host />);
  const button = view.getByRole('button', { name: /来源 S1/ });
  fireEvent.pointerDown(button);
  expect(view.getByRole('button', { name: /来源 S1/ })).toBe(button);
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  expect(openSource).toHaveBeenCalledWith(message.source_links[0], { replyId: 'reply' }, true);
});
