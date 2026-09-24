// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssistantBackgroundTasks } from './AssistantBackgroundTasks';
import { AssistantConversationHistory } from './assistantPanelViews';
import type { AssistantBackgroundRunSnapshot } from './assistantBackgroundRuns';

afterEach(cleanup);
const task = (id: string): AssistantBackgroundRunSnapshot => ({
  root: 'fixture', conversationId: id, conversation: null, question: `任务 ${id}`,
  abortController: new AbortController(), streamingMessageId: null, error: null,
  toolEventsByMessageId: {}, noteProposalsByMessageId: {},
});

it('shows other running conversations with independent open/stop actions and a stopping state', () => {
  const runs = [task('A'), task('B')];
  const onOpen = vi.fn(), onStop = vi.fn();
  const { getByRole, queryByRole, rerender } = render(<AssistantBackgroundTasks runs={runs} currentConversationId="A" onOpen={onOpen} onStop={onStop} />);
  expect(queryByRole('button', { name: '停止后台对话 任务 A' })).toBeNull();
  fireEvent.click(getByRole('button', { name: '任务 B 运行中' }));
  expect(onOpen).toHaveBeenCalledWith('B');
  fireEvent.click(getByRole('button', { name: '停止后台对话 任务 B' }));
  expect(onStop).toHaveBeenCalledWith(runs[1].abortController);
  runs[1].abortController.abort();
  rerender(<AssistantBackgroundTasks runs={runs} currentConversationId="A" onOpen={onOpen} onStop={onStop} />);
  expect((getByRole('button', { name: '停止后台对话 任务 B' }) as HTMLButtonElement).disabled).toBe(true);
  expect(getByRole('button', { name: '任务 B 正在停止' })).toBeTruthy();
});

it('allows opening history during execution but protects a running conversation from deletion', () => {
  const onOpen = vi.fn();
  const { getByRole, getByText } = render(<AssistantConversationHistory busy={false} open loading={false} error={null}
    conversationId={null} runningConversationIds={['A']} items={[{ id: 'A', title: '阅读论文', message_count: 2,
      scope_snapshot: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, created_at: '', updated_at: '' }]}
    onOpen={onOpen} onClose={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} onExport={vi.fn()} />);
  expect(getByText('运行中 · 2 条消息')).toBeTruthy();
  fireEvent.click(getByRole('button', { name: /阅读论文 运行中/ }));
  expect(onOpen).toHaveBeenCalledWith('A');
  expect((getByRole('button', { name: '删除对话 阅读论文' }) as HTMLButtonElement).disabled).toBe(true);
});
