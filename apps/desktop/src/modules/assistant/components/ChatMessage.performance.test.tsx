// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ConversationMessage } from '@/shared/ipc/assistantApi';

import { ChatMessage } from './ChatMessage';

const originalResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('ChatMessage performance boundaries', () => {
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

  it('shows an Apply error and allows retrying the proposal', () => {
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
      <ChatMessage message={message} streaming={false} onOpenSource={() => undefined} />,
    );

    expect(getByText('segment does not exist: v2-continuation-0')).toBeTruthy();
    expect((getByRole('button', { name: /Apply/i }) as HTMLButtonElement).disabled).toBe(false);
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
