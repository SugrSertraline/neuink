// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { type ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistantPanel } from './AssistantPanel';
import { runAssistantHarness } from '../harness/engine';
import { getAssistantBackgroundRuns, setAssistantBackgroundRun } from './assistantBackgroundRuns';
import type { Conversation, ConversationMessage } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal, AssistantTagProposal } from '@/shared/types/assistant';
import { NoteReviewProvider } from '../review/NoteReviewContext';
import { NoteReviewPage } from '../review/NoteReviewPage';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), disks: new Map<string, Conversation>(), nextId: 0 }));
vi.mock('@/shared/components/AppearanceProvider', () => ({ useAppearance: () => ({ appearance: 'standard', setAppearance: vi.fn() }) }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: mocks.notify }) }));
vi.mock('./ExecutionRecovery', () => ({ ExecutionRecovery: () => null }));
vi.mock('./AssistantComposerEditor', () => ({
  AssistantComposerEditor: ({ onChange, resetKey }: ComponentProps<typeof import('./AssistantComposerEditor').AssistantComposerEditor>) =>
    <input key={resetKey} aria-label="输入问题" onChange={event => onChange({ text: event.target.value, mentions: [] }, [], { type: 'doc' })} />,
}));
vi.mock('./useAssistantAutoScroll', () => ({ useAssistantAutoScroll: () => ({
  containerRef: { current: null }, contentRef: { current: null }, endRef: { current: null },
  forceNextScroll: vi.fn(), handleScroll: vi.fn(), isAtBottom: true,
}) }));
vi.mock('../harness/engine', () => ({ runAssistantHarness: vi.fn(), AssistantHarnessError: class extends Error {} }));
vi.mock('../harness/durableHarness', () => ({ acknowledgeExecution: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getLlmSettings: vi.fn(async () => ({ profiles: [{ id: 'test', name: 'test', model: 'test' }], assistant_profile_id: 'test' })),
  subscribeLlmSettings: () => () => {},
  getCachedConversations: () => null,
  listConversations: vi.fn(async () => [...mocks.disks.values()].map(({ messages, ...item }) => ({ ...item, message_count: messages.length }))),
  loadConversation: vi.fn(async (_: string, id: string) => structuredClone(mocks.disks.get(id))),
  createConversation: vi.fn(async (_: string, title: string, scope: Conversation['scope_snapshot']) => {
    const item = { id: `conversation-${++mocks.nextId}`, title, scope_snapshot: scope, messages: [], created_at: '', updated_at: '' };
    mocks.disks.set(item.id, item); return structuredClone(item);
  }),
  appendConversationMessages: vi.fn(async (_: string, id: string, messages: ConversationMessage[]) => {
    const item = mocks.disks.get(id)!;
    item.messages.push(...messages.map((message, index) => ({ ...message, message_id: `${id}-${item.messages.length + index}`, created_at: '', source_links: [] })));
    return structuredClone(item);
  }),
  updateConversationMessage: vi.fn(async (_: string, id: string, messageId: string, patch: Partial<ConversationMessage>) => {
    const item = mocks.disks.get(id)!;
    Object.assign(item.messages.find(message => message.message_id === messageId)!, patch);
    return structuredClone(item);
  }),
  saveAgentRun: vi.fn(async () => {}),
}));

const props = {
  root: 'fixture', status: 'ready', activeEntry: null, activeTag: null, activeNote: null, activeSegment: null,
  activeSurface: { kind: 'library' }, assistantContext: { items: [] }, composerDraft: null, draftQuestion: null,
  entries: [], tags: [], onComposerDraftChange: vi.fn(), onReplaceAssistantContext: vi.fn(), onClearAssistantContext: vi.fn(),
  onDraftQuestionConsumed: vi.fn(), onRemoveAssistantContextItem: vi.fn(), onAddAssistantContext: vi.fn(),
} as unknown as ComponentProps<typeof AssistantPanel>;
type Pending = { options: Parameters<typeof runAssistantHarness>[0]; finish: (value: Awaited<ReturnType<typeof runAssistantHarness>>) => void };
const pending = new Map<string, Pending>();
// jsdom has no layout/scroll implementation; Radix uses this when focusing an option.
HTMLElement.prototype.scrollIntoView = vi.fn();
beforeEach(() => {
  mocks.disks.clear(); mocks.nextId = 0; pending.clear(); mocks.notify.mockClear();
  vi.mocked(runAssistantHarness).mockImplementation(options => new Promise((resolve, reject) => {
    pending.set(options.question, { options, finish: resolve });
    options.abortSignal?.addEventListener('abort', () => reject(new Error('用户停止')), { once: true });
  }));
});
afterEach(() => { cleanup(); setAssistantBackgroundRun(null); });

function paper(id: string): LibraryEntry {
  return { id, title: `论文 ${id}`, contents: [{ kind: 'note', note_id: `note-${id}`, title: `${id} 的笔记` }],
    tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: `${id}.pdf`,
    parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 };
}

it('pins a selected excerpt to its paper across tab changes and freezes the queued request', async () => {
  const a = paper('A'), b = paper('B');
  const selected = { id: 'selection:A:s', kind: 'segment' as const, entryId: 'A', entryTitle: a.title,
    segmentUid: 's', pageIdx: 3, text: 'Only the selected sentence', addedAt: '' };
  const ui = render(<AssistantPanel {...props} entries={[a, b]} activeEntry={b} assistantContext={{ items: [selected] }} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  expect(ui.getByRole('button', { name: '更换阅读对象：论文 A · 第 4 页选区' })).toBeTruthy();
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '解释选区' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(pending.has('解释选区')).toBe(true));
  expect(pending.get('解释选区')!.options.currentEntry?.id).toBe('A');
  expect(pending.get('解释选区')!.options.currentSegment?.text).toBe(selected.text);
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '继续解释选区' } });
  fireEvent.click(ui.getByRole('button', { name: '排队发送' }));
  ui.rerender(<AssistantPanel {...props} entries={[a, b]} activeEntry={b} assistantContext={{ items: [] }} />);
  await act(async () => pending.get('解释选区')!.finish({ answer: '完成', sources: [] }));
  await waitFor(() => expect(pending.has('继续解释选区')).toBe(true));
  expect(pending.get('继续解释选区')!.options.currentEntry?.id).toBe('A');
  expect(pending.get('继续解释选区')!.options.currentSegment?.text).toBe(selected.text);
  await act(async () => pending.get('继续解释选区')!.finish({ answer: '后续完成', sources: [] }));
});

it('sends the chosen note instead of the visible paper and blocks a removed target', async () => {
  const a = paper('A'), b = paper('B');
  const ui = render(<AssistantPanel {...props} entries={[a, b]} activeEntry={b} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.click(ui.getByRole('button', { name: '更换阅读对象：论文 B' }));
  fireEvent.click(await ui.findByRole('button', { name: /A 的笔记/ }));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '整理我的笔记' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(pending.has('整理我的笔记')).toBe(true));
  expect(pending.get('整理我的笔记')!.options.currentNote?.noteId).toBe('note-A');
  expect(pending.get('整理我的笔记')!.options.currentEntry?.id).toBe('A');
  await act(async () => pending.get('整理我的笔记')!.finish({ answer: '完成', sources: [] }));
  ui.rerender(<AssistantPanel {...props} entries={[b]} activeEntry={b} />);
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '再整理一次' } });
  expect(ui.getByText('对象已不可用，请重新选择后发送。')).toBeTruthy();
  expect(ui.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true);
  expect(pending.has('再整理一次')).toBe(false);
});

it('confirms tags only once from the saved proposal and never returns to an old conversation on completion', async () => {
  const proposal: AssistantTagProposal = { id: 'tag-p', action: 'create', name: 'Test', createdAt: '', entryIds: [], status: 'pending' };
  mocks.disks.set('original', { id: 'original', title: '标签对话', created_at: '', updated_at: '',
    scope_snapshot: { tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [] },
    messages: [{ message_id: 'm', role: 'assistant', content: '待确认标签', created_at: '', source_links: [], parts: [{ type: 'tag-proposal', proposal }] }] });
  let finish!: () => void;
  const apply = vi.fn(() => new Promise<void>(resolve => { finish = () => {
    const part = mocks.disks.get('original')!.messages[0].parts![0];
    if (part.type === 'tag-proposal') part.proposal.status = 'applied';
    resolve();
  }; }));
  const ui = render(<AssistantPanel {...props} onApplyTagProposal={apply} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.click(ui.getByRole('button', { name: '聊天历史' }));
  fireEvent.click(await ui.findByRole('button', { name: /^标签对话/ }));
  const confirm = await ui.findByRole('button', { name: '确认应用' });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(confirm); fireEvent.click(confirm);
  await waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith(proposal, { conversationId: 'original', messageId: 'm' }));
  fireEvent.click(ui.getByRole('button', { name: '新建对话' }));
  await act(async () => finish());
  expect(ui.queryByText('待确认标签')).toBeNull();
  expect(apply).toHaveBeenCalledOnce();
});

it('automatically routes queued requests without exposing a mode selector or changing the frozen request', async () => {
  const ui = render(<AssistantPanel {...props} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '正在运行' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(pending.has('正在运行')).toBe(true));
  expect(ui.queryByRole('combobox', { name: '本次请求模式' })).toBeNull();
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '先规划' } });
  fireEvent.click(ui.getByRole('button', { name: '排队发送' }));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '这是后续草稿' } });
  await act(async () => pending.get('正在运行')!.finish({ answer: '完成', sources: [] }));
  await waitFor(() => expect(pending.has('先规划')).toBe(true));
  expect(pending.get('先规划')!.options.composerSnapshot).toEqual({ mentions: [], text: '先规划' });
  expect(pending.get('正在运行')!.options.composerSnapshot?.executionMode).toBeUndefined();
  await act(async () => pending.get('先规划')!.finish({ answer: '只读计划', sources: [] }));
});

it('confirms from review through the original write path without switching back after completion', async () => {
  const proposal: AssistantNoteProposal = { id: 'review-p', action: 'replace', entryId: 'e', entryTitle: '论文', noteId: 'n',
    title: '笔记', markdown: 'New', beforeMarkdown: 'Old', status: 'pending', createdAt: '', sources: [] };
  mocks.disks.set('original', { id: 'original', title: '原对话', created_at: '', updated_at: '',
    scope_snapshot: { tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [] },
    messages: [{ message_id: 'm', role: 'assistant', content: '旧回答', created_at: '', source_links: [], note_proposals: [proposal],
      parts: [{ type: 'note-proposal', proposal }] }] } as Conversation);
  let finish!: (value: AssistantNoteProposal) => void;
  const apply = vi.fn(() => new Promise<AssistantNoteProposal>(resolve => { finish = resolve; }));
  const ui = render(<NoteReviewProvider onOpen={() => {}} onShowAssistant={() => {}}>
    <AssistantPanel {...props} onApplyNoteProposal={apply} /><NoteReviewPage proposalId="review-p" onOpenNote={() => {}} />
  </NoteReviewProvider>);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.click(ui.getByRole('button', { name: '聊天历史' }));
  fireEvent.click(await ui.findByRole('button', { name: /^原对话/ }));
  await waitFor(() => expect(ui.getByRole('button', { name: '确认应用' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(ui.getByRole('button', { name: '确认应用' }));
  expect(apply).toHaveBeenCalledExactlyOnceWith(proposal);
  fireEvent.click(ui.getByRole('button', { name: '新建对话' }));
  await act(async () => finish({ ...proposal, status: 'applied' }));
  await waitFor(() => expect(mocks.disks.get('original')!.messages[0].note_proposals?.[0].status).toBe('applied'));
  expect(ui.queryByText('旧回答')).toBeNull();
  expect(ui.getByText(/已应用 · 历史修改快照/)).toBeTruthy();
});

it('new chat detaches without aborting, reopening follows the running task, and completion releases only its own view', async () => {
  const ui = render(<AssistantPanel {...props} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '任务 A' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(pending.has('任务 A')).toBe(true));
  fireEvent.click(ui.getByRole('button', { name: '新建对话' }));
  expect(ui.queryByRole('button', { name: '停止' })).toBeNull();
  expect(pending.get('任务 A')!.options.abortSignal?.aborted).toBe(false);
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '任务 B' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(getAssistantBackgroundRuns()).toHaveLength(2));
  await waitFor(() => expect(pending.has('任务 B')).toBe(true));
  act(() => pending.get('任务 A')!.options.onToolEvent?.({ id: 'read-A', toolName: 'read', summary: 'A 的专属进度', status: 'running' }));
  expect(ui.queryByText('A 的专属进度')).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '任务 A 运行中' }));
  await waitFor(() => expect(ui.getByRole('article', { name: '你的消息' }).textContent).toContain('任务 A'));
  await act(async () => { pending.get('任务 A')!.finish({ answer: 'A 的最终结果', sources: [] }); });
  await waitFor(() => expect(ui.getByText('A 的最终结果')).toBeTruthy());
  expect(ui.queryByRole('button', { name: '停止' })).toBeNull();
  expect(getAssistantBackgroundRuns()).toHaveLength(1);
  expect(pending.get('任务 B')!.options.abortSignal?.aborted).toBe(false);
  fireEvent.click(ui.getByRole('button', { name: '停止后台对话 任务 B' }));
  await waitFor(() => expect(getAssistantBackgroundRuns()).toHaveLength(0));
  expect(ui.getByText('A 的最终结果')).toBeTruthy();
  expect(ui.queryByText('用户停止')).toBeNull();
});

it('replaces the composer with explicit choices while waiting and restores its draft afterwards', async () => {
  const ui = render(<AssistantPanel {...props} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '整理阅读笔记' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(pending.has('整理阅读笔记')).toBe(true));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '保留我的后续草稿' } });
  const options = pending.get('整理阅读笔记')!.options;
  let answers!: ReturnType<NonNullable<typeof options.requestUserInput>>;
  act(() => {
    answers = options.requestUserInput!({ toolCallId: 'choice', title: '请选择论文', sources: [],
      questions: [{ id: 'paper', title: '整理哪篇论文？', multiple: false,
        options: [{ id: 'wireway', label: 'WireWay' }] }] }, options.abortSignal);
  });
  expect(ui.getByRole('region', { name: '回答助手问题' })).toBeTruthy();
  expect(ui.queryByRole('textbox', { name: '输入问题' })).toBeNull();
  expect(ui.getByRole('button', { name: '提交选择并继续' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(ui.getByRole('radio', { name: 'WireWay' }));
  fireEvent.click(ui.getByRole('button', { name: '提交选择并继续' }));
  await expect(answers).resolves.toEqual({ paper: { selected: ['wireway'], text: '' } });
  expect((ui.getByRole('textbox', { name: '输入问题' }) as HTMLInputElement).value).toBe('保留我的后续草稿');
  await act(async () => pending.get('整理阅读笔记')!.finish({ answer: '继续生成预览', sources: [] }));
});

it('keeps a task running and saves its answer after the panel unmounts', async () => {
  const ui = render(<AssistantPanel {...props} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: '后台任务' } });
  fireEvent.click(ui.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(pending.has('后台任务')).toBe(true));
  ui.unmount();
  expect(pending.get('后台任务')!.options.abortSignal?.aborted).toBe(false);
  await act(async () => { pending.get('后台任务')!.finish({ answer: '后台保存成功', sources: [] }); });
  await waitFor(() => expect(getAssistantBackgroundRuns()).toHaveLength(0));
  expect(mocks.disks.get('conversation-1')!.messages[1].content).toBe('后台保存成功');
});

it('runs the queued follow-up in its original background conversation, not the newly selected one', async () => {
  const ui = render(<AssistantPanel {...props} />);
  await waitFor(() => expect(ui.getByRole('combobox', { name: '对话模型' }).textContent).toContain('test'));
  const submit = (question: string, button = '发送') => {
    fireEvent.change(ui.getByLabelText('输入问题'), { target: { value: question } });
    fireEvent.click(ui.getByRole('button', { name: button }));
  };
  submit('任务 A');
  await waitFor(() => expect(pending.has('任务 A')).toBe(true));
  submit('A 的后续问题', '排队发送');
  fireEvent.click(ui.getByRole('button', { name: '新建对话' }));
  submit('任务 B');
  await waitFor(() => expect(pending.has('任务 B')).toBe(true));
  await act(async () => { pending.get('任务 A')!.finish({ answer: 'A 第一轮完成', sources: [] }); });
  await waitFor(() => expect(pending.has('A 的后续问题')).toBe(true));
  expect(pending.get('A 的后续问题')!.options.conversationId).toBe('conversation-1');
  expect(pending.get('A 的后续问题')!.options.conversationHistory?.some(message => message.content === 'A 第一轮完成')).toBe(true);
  expect(ui.getByRole('article', { name: '你的消息' }).textContent).toContain('任务 B');
  expect(getAssistantBackgroundRuns()).toHaveLength(2);
  await act(async () => {
    pending.get('A 的后续问题')!.finish({ answer: 'A 第二轮完成', sources: [] });
    pending.get('任务 B')!.finish({ answer: 'B 完成', sources: [] });
  });
  await waitFor(() => expect(getAssistantBackgroundRuns()).toHaveLength(0));
  expect(ui.getByText('B 完成')).toBeTruthy();
  expect(ui.queryByText('A 第二轮完成')).toBeNull();
});
