// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import { setAssistantDebug } from '@/shared/lib/assistantDebug';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';
import { ChatMessage } from './ChatMessage';
import { AssistantConversationHistory } from './assistantPanelViews';

const raw = 'Timeout HTTP 504 Authorization: Bearer sk-private C:\\Users\\Alice\\private.pdf /home/alice/private <html>REMOTE_BODY</html>';
beforeEach(() => setAssistantDebug(false));
afterEach(() => { cleanup(); setAssistantDebug(false); window.localStorage.clear(); });

const message = (): ConversationMessage => ({ message_id: 'historical', role: 'assistant', created_at: '',
  content: '保留助手的正常回答。', source_links: [], parts: [
    { type: 'error', message: raw, id: 'failed-tool', toolName: 'import_papers' },
    { type: 'agent-run', run: { id: 'old-run', status: 'failed', startedAt: '', subagentTaskCount: 0,
      verifierErrors: 0, verifierWarnings: 0, nodes: [{ id: 'node', kind: 'tool', status: 'failed', startedAt: '',
        title: '论文添加', error: raw, inputSummary: raw, outputSummary: raw }] } },
  ] });

it('protects historical error parts and failed-node tooltips, including when debug changes while mounted', () => {
  const original = message();
  const ui = render(<ChatMessage message={original} streaming={false} onOpenSource={vi.fn()} />);
  expect(ui.getByText('保留助手的正常回答。')).toBeTruthy();
  expect(ui.getByText('本次执行已结束，部分操作未完成；请核对结果后再试。')).toBeTruthy();
  fireEvent.click(ui.getByRole('button', { name: '展开执行详情' }));
  expect(ui.container.innerHTML).not.toContain('sk-private');
  expect(ui.getByText('论文添加').parentElement?.title).toBe('本次执行已结束，部分操作未完成；请核对结果后再试。');
  act(() => setAssistantDebug(true));
  expect(ui.getAllByText(/调试：请求超时 · HTTP 504/).length).toBeGreaterThan(0);
  for (const secret of ['sk-private', 'Authorization', 'Alice', '/home/alice', 'REMOTE_BODY'])
    expect(ui.container.innerHTML).not.toContain(secret);
  act(() => setAssistantDebug(false));
  expect(ui.container.textContent).not.toContain('调试：');
  expect(original.parts?.[0]).toEqual({ type: 'error', message: raw, id: 'failed-tool', toolName: 'import_papers' });
});

it('keeps a failed live tool in the assistant processing flow instead of showing its raw summary', () => {
  const ui = render(<ChatMessage message={{ ...message(), parts: [] }} streaming onOpenSource={vi.fn()}
    toolEvents={[{ id: 'live', toolName: 'search_papers', status: 'error', summary: raw }]} />);
  fireEvent.click(ui.getByRole('button', { name: '展开执行详情' }));
  expect(ui.getByText('工具未完成，助手正在处理。')).toBeTruthy();
  expect(ui.container.textContent).not.toContain(raw);
});

it('shows the fixed citation failure after execution ends, with no raw tool diagnostics or false cancellation', () => {
  const value: ConversationMessage = { message_id: 'citation-failure', role: 'assistant', content: '', created_at: '', source_links: [],
    parts: [{ type: 'error', message: ASSISTANT_READ_FAILURES.citation }] };
  const ui = render(<ChatMessage message={value} streaming={false} onOpenSource={vi.fn()} />);
  expect(ui.getByText(ASSISTANT_READ_FAILURES.citation)).toBeTruthy();
  expect(ui.container.textContent).not.toContain('核对结果后再试');
  expect(ui.container.textContent).not.toContain('正在处理');
  act(() => setAssistantDebug(true));
  expect(ui.getByText(/调试：引用或输出要求未满足/)).toBeTruthy();
});

it('gives historical summary-only failures the same safe collapsed status', () => {
  const ui = render(<ChatMessage message={{ ...message(), parts: [] }} streaming={false} onOpenSource={vi.fn()}
    toolEvents={[{ id: 'old', toolName: 'search_papers', status: 'error', summary: raw }]} />);
  expect(ui.getByText('助手已根据可用结果完成回答，部分操作未完成。')).toBeTruthy();
  expect(ui.container.innerHTML).not.toContain('sk-private');
  act(() => setAssistantDebug(true));
  expect(ui.getByText(/调试：请求超时 · HTTP 504/)).toBeTruthy();
  expect(ui.container.innerHTML).not.toContain('REMOTE_BODY');
});

it.each([
  ['succeeded', '助手已根据可用结果完成回答，部分操作未完成。', '已回答 · 部分操作未完成'],
  ['failed', '本次执行已结束，部分操作未完成；请核对结果后再试。', '本次未完成'],
  ['canceled', '本次执行已停止，部分操作未完成；请先核对已有结果。', '已停止'],
] as const)('uses authoritative %s completion for historic tool failures and tooltips', (status, notice, label) => {
  const original = message();
  const value = { ...original, parts: original.parts?.map(part => part.type === 'agent-run'
    ? { ...part, run: { ...part.run, status } } : part) };
  const ui = render(<ChatMessage message={value} streaming={false} onOpenSource={vi.fn()} />);
  expect(ui.getByRole('status').textContent).toBe(label);
  expect(ui.getByText(notice)).toBeTruthy();
  fireEvent.click(ui.getByRole('button', { name: '展开执行详情' }));
  expect(ui.getAllByText(notice)).toHaveLength(2);
  expect(ui.getByText('论文添加').parentElement?.title).toBe(notice);
  act(() => setAssistantDebug(true));
  expect(ui.getAllByText(new RegExp(notice + ' 调试：请求超时 · HTTP 504'))).toHaveLength(2);
  expect(ui.container.innerHTML).not.toContain('等待助手');
  expect(ui.container.innerHTML).not.toContain('正在处理');
  expect(ui.container.innerHTML).not.toContain('sk-private');
});

it('updates expanded tool history when processing finishes without claiming the failed tool succeeded', () => {
  const original = message();
  const value = { ...original, parts: original.parts?.map(part => part.type === 'agent-run'
    ? { ...part, run: { ...part.run, status: 'running' as const } } : part) };
  const ui = render(<ChatMessage message={value} streaming onOpenSource={vi.fn()} />);
  fireEvent.click(ui.getByRole('button', { name: '展开执行详情' }));
  expect(ui.getByText('工具未完成，助手正在处理。')).toBeTruthy();
  const final = { ...value, parts: value.parts?.map(part => part.type === 'agent-run'
    ? { ...part, run: { ...part.run, status: 'succeeded' as const } } : part) };
  ui.rerender(<ChatMessage message={final} streaming={false} onOpenSource={vi.fn()} />);
  expect(ui.getAllByText('助手已根据可用结果完成回答，部分操作未完成。')).toHaveLength(2);
  expect(ui.container.textContent).not.toContain('正在处理');
  expect(ui.container.textContent).not.toContain('等待助手');
  expect(ui.getByText('论文添加').parentElement?.title).toContain('部分操作未完成');
  expect(final.parts?.find(part => part.type === 'error')).toEqual(original.parts?.[0]);
});

it('does not infer a finished answer from whitespace when an old run has no terminal status', () => {
  const ui = render(<ChatMessage message={{ ...message(), content: '   ', parts: [message().parts![0]] }}
    streaming={false} onOpenSource={vi.fn()} />);
  expect(ui.getByText('本次执行已结束，部分操作未完成；请核对结果后再试。')).toBeTruthy();
  expect(ui.queryByText('助手已根据可用结果完成回答，部分操作未完成。')).toBeNull();
});

it('keeps conversation history failure distinct without leaking its IPC message', () => {
  const ui = render(<AssistantConversationHistory busy={false} conversationId={null} error={raw} items={[]} loading={false}
    onClose={vi.fn()} onDelete={vi.fn()} onExport={vi.fn()} onOpen={vi.fn()} onRename={vi.fn()} open />);
  expect(ui.getByText('聊天历史读取未完成，请稍后重试。')).toBeTruthy();
  act(() => setAssistantDebug(true));
  expect(ui.getByText(/调试：请求超时 · HTTP 504/)).toBeTruthy();
  expect(ui.container.innerHTML).not.toContain('sk-private');
});

it('protects successful legacy fallback traces and tooltips without filtering the answer, evidence, or normal summaries', () => {
  const summary = `Found 1 segment for "query" using hybrid_fallback_keyword. Embedding search is unavailable: ${raw}. Showing keyword fallback results.`;
  const content = '论文正文讨论 Embedding search is unavailable: 这只是引用内容。';
  const source = { entry_id: 'entry', entry_title: '真实论文', page_idx: 0, segment_uid: 'segment', quote: content };
  const normal = 'Found 1 segment for "query" using keyword.';
  const original: ConversationMessage = { message_id: 'legacy-fallback', role: 'assistant', created_at: '', content,
    source_links: [source], parts: [
      { type: 'tool-result', id: 'search', toolName: 'search_segments', summary, sourceLinks: [source] },
      { type: 'tool-result', id: 'normal', toolName: 'search_segments', summary: normal },
      { type: 'agent-run', run: { id: 'old-success', status: 'succeeded', startedAt: '', subagentTaskCount: 0,
        verifierErrors: 0, verifierWarnings: 0, nodes: [{ id: 'legacy', kind: 'tool', status: 'succeeded', startedAt: '',
          title: '旧版检索', outputSummary: summary }] } },
    ] };
  const snapshot = JSON.stringify(original);
  const ui = render(<ChatMessage message={original} streaming={false} onOpenSource={vi.fn()} />);
  fireEvent.click(ui.getByRole('button', { name: '展开执行详情' }));
  const notice = '向量检索不可用，已使用关键词检索结果；现有证据仍可查看。';
  expect(ui.getByText(notice)).toBeTruthy();
  expect(ui.getByText('旧版检索').parentElement?.title).toBe(notice);
  expect(ui.getByText(normal)).toBeTruthy();
  expect(ui.getByText(content)).toBeTruthy();
  act(() => setAssistantDebug(true));
  expect(ui.getByText(/调试：请求超时 · HTTP 504/)).toBeTruthy();
  expect(ui.getByText('旧版检索').parentElement?.title).toContain('调试：请求超时 · HTTP 504');
  for (const secret of ['sk-private', 'Authorization', 'Alice', '/home/alice', 'REMOTE_BODY']) expect(ui.container.innerHTML).not.toContain(secret);
  expect(JSON.stringify(original)).toBe(snapshot);
  expect(original.source_links[0]).toEqual(source);
});
