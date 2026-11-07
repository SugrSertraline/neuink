// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { AssistantToolTraceEvent, ConversationMessage } from '@/shared/ipc/assistantApi';
import { ChatMessage } from './ChatMessage';
import { buildAssistantMessageParts } from './assistantPanelState';
import type { AssistantExecutionItem } from './assistantExecutionTimeline';

afterEach(cleanup);

it('renders thinking and tools in arrival order and keeps tool updates in place after reload', () => {
  const executionTimeline: AssistantExecutionItem[] = [
    { type: 'reasoning', text: '先检查来源。' }, { type: 'tool', id: 'read' },
    { type: 'reasoning', text: '再比较结果。' }, { type: 'tool', id: 'search' },
    { type: 'reasoning', text: '根据已有来源回答。' },
  ];
  let events: AssistantToolTraceEvent[] = [
    { id: 'read', toolName: 'read_pdf_pages', status: 'running' },
    { id: 'search', toolName: 'search_pdf_text', status: 'running' },
  ];
  const message = (): ConversationMessage => ({
    message_id: 'timeline', role: 'assistant', created_at: '', content: '回答正文', source_links: [],
    parts: buildAssistantMessageParts({ content: '回答正文', executionTimeline, toolEvents: events }),
  });
  const ui = render(<ChatMessage message={message()} streaming toolEvents={events} onOpenSource={() => {}} />);
  const toggle = ui.getByRole('button', { name: '展开执行详情' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  const expectedOrder = ['先检查来源。', '读取 PDF 文字', '再比较结果。', '搜索 PDF 文字', '根据已有来源回答。'];
  const checkOrder = () => {
    const timeline = within(ui.getByLabelText('执行时间线'));
    const nodes = expectedOrder.map(text => timeline.getByText(text));
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(timeline.getAllByText('读取 PDF 文字')).toHaveLength(1);
    expect(timeline.getAllByText('搜索 PDF 文字')).toHaveLength(1);
  };
  checkOrder();
  events = [
    { ...events[0], status: 'done', summary: '读取完成' },
    { ...events[1], status: 'error', error: '搜索失败' },
  ];
  const reloaded = JSON.parse(JSON.stringify(message()));
  // History reconstruction uses persisted parts with no separate live tool-events prop.
  ui.rerender(<ChatMessage message={reloaded} streaming={false} onOpenSource={() => {}} />);
  checkOrder();
  expect(ui.getByText('读取完成')).toBeTruthy();
  expect(within(ui.getByLabelText('执行时间线')).getByText('失败')).toBeTruthy();
  expect(ui.getByText('回答正文')).toBeTruthy();
  const collapse = ui.getByRole('button', { name: '收起执行详情' });
  expect(collapse.getAttribute('aria-controls')).toBe(toggle.getAttribute('aria-controls'));
  fireEvent.click(collapse);
  expect(ui.queryByLabelText('执行时间线')).toBeNull();
  expect(ui.getByText('回答正文')).toBeTruthy();
});

it('keeps legacy reasoning and separately supplied tool traces accessible', () => {
  const message: ConversationMessage = { message_id: 'legacy', role: 'assistant', created_at: '',
    content: '', source_links: [], parts: [{ type: 'reasoning', text: '旧思考' }] };
  const ui = render(<ChatMessage message={message} streaming={false}
    toolEvents={[{ id: 'read', toolName: 'read_pdf_pages', status: 'done' }]} onOpenSource={() => {}} />);
  fireEvent.click(ui.getByRole('button', { name: '展开执行详情' }));
  const timeline = within(ui.getByLabelText('执行时间线'));
  expect(timeline.getByText('旧思考')).toBeTruthy();
  expect(timeline.getByText('读取 PDF 文字')).toBeTruthy();
});
