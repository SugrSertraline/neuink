// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserInputPanel } from './UserInputPanel';
import { cancelUserInput, getUserInputs, requestUserInput, submitUserInput, updateUserInputDraft, type UserInputRequest } from '../runtime/userInput';

const request: UserInputRequest = { title: '整理阅读笔记', toolCallId: 'call-1', sources: [],
  previewMarkdown: '## 笔记结构\n\n- 研究问题\n- 方法与局限', questions: [
    { id: 'paper', title: '整理哪些论文？', multiple: true, options: [{ id: 'wireway', label: 'WireWay' }, { id: 'other', label: '另一篇论文' }] },
    { id: 'output', title: '如何输出？', multiple: false, options: [{ id: 'draft', label: '生成待审阅笔记' }, { id: 'chat', label: '仅在对话中回答' }] }
  ] };
afterEach(() => { cleanup(); getUserInputs().forEach(item => cancelUserInput(item.id)); });

it('requires explicit answers, previews without submitting and continues exactly once', async () => {
  const pending = requestUserInput('root', 'chat')(request);
  const done = vi.fn(); pending.then(done);
  const ui = render(<UserInputPanel root="root" conversationId="chat" onOpen={vi.fn()} onOpenSource={vi.fn()} />);
  const submit = ui.getByRole('button', { name: '提交选择并继续' });
  expect(submit.hasAttribute('disabled')).toBe(true);
  fireEvent.click(ui.getByText('预览方案／笔记结构'));
  expect(within(ui.getByRole('dialog')).getByRole('heading', { name: '笔记结构' })).toBeTruthy();
  expect(done).not.toHaveBeenCalled();
  fireEvent.keyDown(ui.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(ui.getByRole('checkbox', { name: 'WireWay' }));
  fireEvent.click(ui.getByRole('checkbox', { name: '另一篇论文' }));
  fireEvent.click(ui.getByRole('radio', { name: '生成待审阅笔记' }));
  expect(submit.hasAttribute('disabled')).toBe(false);
  fireEvent.click(submit); fireEvent.click(submit);
  expect(await pending).toEqual({ paper: { selected: ['wireway', 'other'], text: '' }, output: { selected: ['draft'], text: '' } });
  expect(done).toHaveBeenCalledTimes(1);
  expect(ui.queryByText('提交选择并继续')).toBeNull();
});

it('retains custom answers across unmounts and isolates background conversations/workspaces', async () => {
  const pending = requestUserInput('root', 'original')(request); const rejected = expect(pending).rejects.toThrow('取消');
  const open = vi.fn();
  const view = (root: string, conversationId: string) => <UserInputPanel root={root} conversationId={conversationId} onOpen={open} onOpenSource={vi.fn()} />;
  const ui = render(view('root', 'original'));
  fireEvent.change(ui.getAllByRole('textbox')[0], { target: { value: '只整理当前论文，不需要其他两篇' } });
  ui.rerender(view('root', 'new'));
  expect(ui.queryByText('提交选择并继续')).toBeNull();
  fireEvent.click(ui.getByText('另一个对话等待选择，点击查看'));
  expect(open).toHaveBeenCalledWith('original');
  ui.rerender(view('other-root', 'original'));
  expect(ui.container.textContent).toBe('');
  ui.unmount();
  const again = render(view('root', 'original'));
  expect((again.getAllByRole('textbox')[0] as HTMLTextAreaElement).value).toContain('只整理当前论文');
  fireEvent.click(again.getByText('取消并停止'));
  await rejected;
});

it('validates submitted IDs and makes stale or stopped requests inert', async () => {
  const abort = new AbortController();
  const pending = requestUserInput('root', 'chat')(request, abort.signal); const rejected = expect(pending).rejects.toThrow();
  const id = getUserInputs()[0].id;
  updateUserInputDraft(id, { paper: { selected: ['unknown'], text: '' }, output: { selected: ['draft', 'chat'], text: '' } });
  expect(submitUserInput(id)).toContain('无效');
  act(() => abort.abort()); await rejected;
  expect(getUserInputs()).toHaveLength(0);
  expect(submitUserInput(id)).toContain('已结束');
});
