// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationMessage } from '@/shared/ipc/assistantApi';

import { ChatMessage } from './ChatMessage';

const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('ChatMessage performance boundaries', () => {
  it('enlarges completed replies in a read-only preview and leaves plain questions as text', () => {
    const ui = render(<ChatMessage message={{ ...createMessage(), content: '## 请问\n\n是否整理 WireWay？' }} streaming={false} onOpenSource={vi.fn()} />);
    expect(ui.container.querySelector('.assistant-chat-message')?.className).toContain('text-sm');
    fireEvent.click(ui.getByRole('button', { name: '展开阅读' }));
    expect(ui.getByRole('dialog')).toBeTruthy();
    expect(ui.getAllByText('是否整理 WireWay？')).toHaveLength(2);
    expect(ui.queryByRole('button', { name: '确认执行' })).toBeNull();
  });

  it('stops the thinking animation while a structured question is awaiting an answer', () => {
    const ui = render(<ChatMessage message={createMessage()} streaming toolEvents={[{ id: 'ask', toolName: 'ask_user', status: 'running' }]} onOpenSource={vi.fn()} />);
    expect(ui.getByText('等待你的选择')).toBeTruthy();
    expect(ui.container.querySelector('[data-thinking-animation]')).toBeNull();
  });
  it('distinguishes left assistant and right user bubbles with accessible speaker labels', () => {
    const { getByRole } = render(<>
      <ChatMessage message={{ ...createMessage(), role: 'user', content: '你好' }} streaming={false} onOpenSource={() => undefined} />
      <ChatMessage message={createMessage()} streaming={false} onOpenSource={() => undefined} />
    </>);
    expect(getByRole('article', { name: '你的消息' }).className).toContain('flex-row-reverse');
    expect(getByRole('article', { name: 'Neuink 的回复' }).className).not.toContain('flex-row-reverse');
  });

  it('animates only active execution and respects reduced-motion preferences', () => {
    const message = { ...createMessage(), content: '' };
    const { container, rerender } = render(<ChatMessage message={message} streaming onOpenSource={() => undefined} />);
    const animation = container.querySelector('[data-thinking-animation]');
    expect(animation).not.toBeNull();
    expect(animation?.querySelectorAll('.motion-reduce\\:animate-none')).toHaveLength(3);
    rerender(<ChatMessage message={message} streaming={false} onOpenSource={() => undefined} />);
    expect(container.querySelector('[data-thinking-animation]')).toBeNull();
  });

  it('does not attach a ResizeObserver for static message layout', () => {
    const observe = vi.fn();
    globalThis.ResizeObserver = class ResizeObserverMock {
      observe = observe;
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;

    render(
      <ChatMessage
        message={createMessage()}
        streaming={false}
        onOpenSource={() => undefined}
      />,
    );

    expect(observe).not.toHaveBeenCalled();
  });

  it('renders Markdown while the assistant response is still streaming', () => {
    const { container } = render(
      <ChatMessage
        message={createMessage()}
        streaming
        onOpenSource={() => undefined}
      />,
    );

    expect(container.querySelector('strong')?.textContent).toBe('Markdown');
    expect(container.textContent).not.toContain('**Markdown**');
  });

  it('keeps reasoning hidden while streaming and only mounts details on request', () => {
    const message = createMessage();
    message.parts = [{ type: 'reasoning', text: '先确认当前上下文，再选择需要调用的工具。' }];

    const { getByRole, getByText, queryByText, rerender } = render(
      <ChatMessage
        message={message}
        streaming
        onOpenSource={() => undefined}
      />,
    );

    expect(getByRole('button', { name: '展开执行详情' }).getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('先确认当前上下文，再选择需要调用的工具。')).toBeNull();
    fireEvent.click(getByRole('button', { name: '展开执行详情' }));
    expect(getByText('先确认当前上下文，再选择需要调用的工具。')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: '收起执行详情' }));
    rerender(<ChatMessage message={{ ...message, content: '更多回答' }} streaming onOpenSource={() => undefined} />);
    expect(getByRole('button', { name: '展开执行详情' }).getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('先确认当前上下文，再选择需要调用的工具。')).toBeNull();
  });

  it('collapses tool traces and memory together without hiding answers or errors', () => {
    const message = createMessage();
    message.parts = [
      { type: 'reasoning', text: '隐藏的长思考' },
      { type: 'error', message: '资料库无法访问' },
      { type: 'memory', memory: { summary: '隐藏的记忆', decisions: [], entities: [], open_items: [],
        user_preferences: [], last_user_goal: '', message_count: 2, source_count: 0, pending_proposal_count: 0, updated_at: '' } },
    ];
    const { getByRole, queryByText, getByText } = render(<ChatMessage message={message} streaming={false} onOpenSource={() => undefined} />);
    expect(getByText('Markdown')).toBeTruthy();
    expect(getByText('资料库无法访问')).toBeTruthy();
    expect(queryByText('隐藏的记忆')).toBeNull();
    expect(queryByText('隐藏的长思考')).toBeNull();
    const toggle = getByRole('button', { name: '展开执行详情' });
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.click(toggle);
    expect(getByText('隐藏的记忆')).toBeTruthy();
    expect(getByText('隐藏的长思考')).toBeTruthy();
  });

  it('shows one compact status for an empty streaming response and none for plain completed text', () => {
    const message = { ...createMessage(), content: '' };
    const { getByRole, queryByRole, rerender } = render(<ChatMessage message={message} streaming onOpenSource={() => undefined} />);
    expect(getByRole('status').textContent).toBe('正在处理');
    expect(getByRole('button', { name: '展开执行详情' }).getAttribute('aria-expanded')).toBe('false');
    rerender(<ChatMessage message={createMessage()} streaming={false} onOpenSource={() => undefined} />);
    expect(queryByRole('button', { name: '展开执行详情' })).toBeNull();
  });

  it('shows an Apply error and allows retrying the proposal', () => {
    const apply = vi.fn();
    const message = createMessage();
    message.parts = [{
      proposal: {
        action: 'create',
        createdAt: '2026-07-13T00:00:00.000Z',
        entryId: 'entry-1',
        entryTitle: 'Paper',
        error: 'segment does not exist: v2-continuation-0',
        id: 'proposal-1',
        markdown: '# Note',
        noteId: null,
        noteTitle: null,
        pageIdx: null,
        segmentUid: null,
        sources: [],
        status: 'error',
        targetKind: 'markdown_note',
        title: 'Paper note'
      },
      type: 'note-proposal'
    }];

    const { getByRole, getByText } = render(
      <ChatMessage message={message} streaming={false} onOpenSource={() => undefined} onApplyNoteProposal={apply} />,
    );

    expect(getByText('segment does not exist: v2-continuation-0')).toBeTruthy();
    expect((getByRole('button', { name: '确认' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByRole('button', { name: '确认' }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it('collapses source links beyond ten until the user expands them', () => {
    const message = createMessage();
    message.source_links = Array.from({ length: 12 }, (_, index) => ({
      entry_id: 'entry-1',
      entry_title: 'Paper',
      page_idx: index,
      quote: `Source ${index + 1}`,
      segment_uid: `segment-${index + 1}`
    }));

    const { getByRole, queryByRole } = render(
      <ChatMessage message={message} streaming={false} onOpenSource={() => undefined} />,
    );

    expect(getByRole('button', { name: 'S10 · p.10' })).toBeTruthy();
    expect(queryByRole('button', { name: 'S11 · p.11' })).toBeNull();

    fireEvent.click(getByRole('button', { name: '展开全部来源（+2）' }));

    expect(getByRole('button', { name: 'S11 · p.11' })).toBeTruthy();
    expect(getByRole('button', { name: '收起来源' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('renders a cited local source inline and opens the exact source', () => {
    const message = createMessage();
    message.content = '这一结论来自当前论文 [S1]。';
    message.source_links = [{
      entry_id: 'entry-1',
      entry_title: 'Current paper',
      page_idx: 2,
      quote: 'The cited paragraph.',
      segment_uid: 'segment-1'
    }];
    const onOpenSource = vi.fn();

    const { getByRole } = render(
      <ChatMessage message={message} streaming={false} onOpenSource={onOpenSource} />,
    );

    fireEvent.click(getByRole('button', { name: '来源 S1：Current paper，p.3' }));

    expect(onOpenSource).toHaveBeenCalledWith(message.source_links[0]);
  });

  it('groups Sciverse evidence by paper and imports the paper once', async () => {
    const message = createMessage();
    message.content = '两个证据位置支持同一结论 [S1][S2]。';
    message.source_links = [0, 1].map((index) => ({
      provider: 'sciverse' as const,
      chunk_id: `chunk-${index + 1}`,
      doc_id: 'doc-1',
      offset: index * 2000,
      page_no: index + 1,
      quote: `Evidence ${index + 1}`,
      title: 'A Sciverse paper'
    }));
    const onAddSciverseSource = vi.fn().mockResolvedValue({
      entryId: 'entry-imported',
      message: 'created',
      status: 'created_with_pdf'
    });

    const { getAllByRole, getByRole, getByText } = render(
      <ChatMessage
        message={message}
        streaming={false}
        onAddSciverseSource={onAddSciverseSource}
        onOpenSource={() => undefined}
      />,
    );

    expect(getByText('引用来源 2 · 检索论文 1')).toBeTruthy();
    expect(getByRole('button', { name: 'S1 · p.1' })).toBeTruthy();
    expect(getByRole('button', { name: 'S2 · p.2' })).toBeTruthy();
    expect(getAllByRole('button', { name: '一键加入文库' })).toHaveLength(1);

    fireEvent.click(getByRole('button', { name: '一键加入文库' }));

    await waitFor(() => expect(getByRole('button', { name: '已加入并解析' })).toBeTruthy());
    expect(onAddSciverseSource).toHaveBeenCalledTimes(1);
    expect(onAddSciverseSource).toHaveBeenCalledWith(message.source_links[0]);
  });

  it('opens the requested source once when the same Sciverse citation is repeated', () => {
    const message = createMessage();
    message.content = 'External finding [S1]. Repeated evidence [S1]. Summary [S1].';
    message.source_links = [{
      provider: 'sciverse',
      doc_id: 'doc-1',
      page_no: 1,
      quote: 'Evidence excerpt.',
      title: 'A Sciverse paper'
    }];

    const onOpenSource = vi.fn();
    const { getAllByRole } = render(
      <ChatMessage message={message} streaming={false} onOpenSource={onOpenSource} />,
    );

    const citationButtons = getAllByRole('button', {
      name: '来源 S1：A Sciverse paper，p.1'
    });
    expect(citationButtons).toHaveLength(3);
    fireEvent.click(citationButtons[1]);
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onOpenSource).toHaveBeenCalledWith(message.source_links[0]);
  });

  it('keeps uncited agentic-search papers available as an import list', () => {
    const message = createMessage();
    message.content = '正文只引用第一篇 [S1]。';
    message.source_links = [{
      provider: 'sciverse',
      doc_id: 'doc-1',
      title: 'Cited paper',
      quote: 'Cited evidence'
    }];
    message.parts = [{
      id: 'tool-1',
      sourceLinks: [
        message.source_links[0],
        {
          provider: 'sciverse',
          doc_id: 'doc-2',
          title: 'Uncited search result',
          quote: 'Another relevant result'
        }
      ],
      summary: 'Found two papers.',
      toolName: 'search_sciverse_evidence',
      type: 'tool-result'
    }];

    const { getAllByRole, getByText } = render(
      <ChatMessage
        message={message}
        streaming={false}
        onAddSciverseSource={vi.fn()}
        onOpenSource={() => undefined}
      />,
    );

    expect(getByText('引用来源 1 · 检索论文 2')).toBeTruthy();
    expect(getByText('Uncited search result')).toBeTruthy();
    expect(getAllByRole('button', { name: '一键加入文库' })).toHaveLength(2);
  });
});

function createMessage(): ConversationMessage {
  return {
    content: 'A static assistant response with **Markdown**.',
    created_at: '2026-07-13T00:00:00.000Z',
    message_id: 'message-1',
    parts: [],
    role: 'assistant',
    source_links: []
  } as ConversationMessage;
}
