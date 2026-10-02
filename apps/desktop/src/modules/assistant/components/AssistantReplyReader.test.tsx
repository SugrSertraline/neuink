// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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
  expect(openSource).toHaveBeenCalledWith(message.source_links[0]);
});
