// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantComposerEditor, type AssistantComposerDraft } from './AssistantComposerEditor';
import { AssistantReplyActionsContext } from './AssistantReplyActionsContext';
import { ChatMessage } from './ChatMessage';
import { AssistantExternalContextItems } from './AssistantExternalContextItems';
import { AssistantMentionChip } from './AssistantMentionChip';
import { pdfBlockDrag } from '@/shared/lib/pdfBlockDrag';
import type { AssistantComposerMention, AssistantContextItem } from '@/shared/types/assistant';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';

class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
}
const rangeRectsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(224);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(384);
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => {
    const rect = new DOMRect(0, 0, 1, 1);
    return { 0: rect, length: 1, item: () => rect };
  } });
});
afterEach(() => {
  cleanup(); pdfBlockDrag.cancel(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (rangeRectsDescriptor) Object.defineProperty(Range.prototype, 'getClientRects', rangeRectsDescriptor);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

const excerpt = '**Exact evidence** ' + 'A long passage with a preserved context. '.repeat(20) + 'END OF EVIDENCE';
const mention: AssistantComposerMention = { id: 'segment:paper:seg-4', kind: 'segment', entryId: 'paper', entryTitle: 'Paper Alpha',
  label: '保存的片段', marker: '[C1]', charOffset: 4, pageIdx: 3, segmentUid: 'seg-4', text: excerpt };
const item: AssistantContextItem = { id: mention.id, kind: 'segment', entryId: 'paper', entryTitle: 'Paper Alpha',
  segmentUid: 'seg-4', pageIdx: 3, text: excerpt, addedAt: '2026-10-10' };
const source = { entry_id: 'paper', entry_title: 'Paper Alpha', segment_uid: 'seg-4', page_idx: 3, quote: excerpt };
const draft: AssistantComposerDraft = { document: { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: '请解释 ' }, { type: 'contextMention', attrs: mention }, { type: 'text', text: ' 的方法。' }
] }] }, snapshot: { text: '请解释 [C1] 的方法。', mentions: [mention] } };
const props = { composerDraft: draft, disabled: false, draftQuestion: null, entries: [], tags: [], resetKey: 0,
  onDraftQuestionConsumed: vi.fn(), onChange: vi.fn(), onSubmit: vi.fn() };
function actions() { return { root: 'library-a', openReply: vi.fn(), openSource: vi.fn(), openContext: vi.fn(), addSciverseSource: vi.fn() }; }
function message(content: string, parts: ConversationMessage['parts'], role: 'user' | 'assistant' = 'user'): ConversationMessage {
  return { content, parts, role, message_id: 'm1', created_at: '2026-10-10', source_links: [] } as ConversationMessage;
}
async function preview(trigger: HTMLElement) {
  fireEvent.pointerMove(trigger, { buttons: 0 });
  return screen.findByLabelText(/引用详情：/);
}

describe('draft reference interaction', () => {
  it('previews full saved evidence and opens its exact source without editing or sending', async () => {
    const nav = actions(); const onChange = vi.fn(); const onSubmit = vi.fn();
    render(<AssistantReplyActionsContext.Provider value={nav}><AssistantComposerEditor {...props} onChange={onChange} onSubmit={onSubmit} /></AssistantReplyActionsContext.Provider>);
    const trigger = await screen.findByRole('button', { name: '定位引用：Paper Alpha，片段 · 第 4 页' });
    const details = await preview(trigger);
    expect(within(details).getByText('Exact evidence').tagName).toBe('STRONG');
    expect(details.textContent).toContain('END OF EVIDENCE');
    expect(details.textContent).toContain('第 4 页');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText(/引用详情：/)).toBeNull());
    onChange.mockClear();
    expect(fireEvent.mouseDown(trigger)).toBe(false);
    fireEvent.click(trigger);
    expect(nav.openSource).toHaveBeenCalledExactlyOnceWith(source);
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('removes just the reference, supports undo/redo and never navigates or submits from its buttons', async () => {
    const nav = actions(); const onChange = vi.fn(); const onSubmit = vi.fn();
    const view = render(<AssistantReplyActionsContext.Provider value={nav}><AssistantComposerEditor {...props} onChange={onChange} onSubmit={onSubmit} /></AssistantReplyActionsContext.Provider>);
    const remove = await screen.findByRole('button', { name: '移除引用：Paper Alpha，片段 · 第 4 页' });
    fireEvent.keyDown(remove, { key: 'Enter' });
    fireEvent.click(remove);
    await waitFor(() => expect(view.container.querySelector('[data-context-mention]')).toBeNull());
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ text: '请解释  的方法。', mentions: [] });
    expect(nav.openSource).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '输入问题' }), { key: 'z', code: 'KeyZ', ctrlKey: true });
    await screen.findByRole('button', { name: '移除引用：Paper Alpha，片段 · 第 4 页' });
    expect(onChange.mock.lastCall?.[0].mentions[0]).toMatchObject({ text: excerpt, pageIdx: 3, segmentUid: 'seg-4' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '输入问题' }), { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(view.container.querySelector('[data-context-mention]')).toBeNull());
  });

  it('keeps preview and navigation available but removes deletion when the composer becomes read-only', async () => {
    const nav = actions();
    const view = render(<AssistantReplyActionsContext.Provider value={nav}><AssistantComposerEditor {...props} /></AssistantReplyActionsContext.Provider>);
    await screen.findByRole('button', { name: /移除引用/ });
    view.rerender(<AssistantReplyActionsContext.Provider value={nav}><AssistantComposerEditor {...props} disabled /></AssistantReplyActionsContext.Provider>);
    await waitFor(() => expect(screen.queryByRole('button', { name: /移除引用/ })).toBeNull());
    const trigger = screen.getByRole('button', { name: /定位引用/ });
    expect(trigger.getAttribute('aria-disabled')).toBe('false');
    await preview(trigger);
    fireEvent.click(trigger);
    expect(nav.openSource).toHaveBeenCalledWith(source);
  });

  it('uses the current navigation callback after rerender without replacing the editor node', async () => {
    const first = actions(), next = actions();
    const view = render(<AssistantReplyActionsContext.Provider value={first}><AssistantComposerEditor {...props} /></AssistantReplyActionsContext.Provider>);
    const trigger = await screen.findByRole('button', { name: /定位引用/ });
    view.rerender(<AssistantReplyActionsContext.Provider value={next}><AssistantComposerEditor {...props} /></AssistantReplyActionsContext.Provider>);
    expect(screen.getByRole('button', { name: /定位引用/ })).toBe(trigger);
    fireEvent.click(trigger);
    expect(first.openSource).not.toHaveBeenCalled();
    expect(next.openSource).toHaveBeenCalledWith(source);
  });

  it('opens the preview with keyboard focus and locates from its explicit action', async () => {
    const nav = actions();
    render(<AssistantReplyActionsContext.Provider value={nav}><AssistantComposerEditor {...props} /></AssistantReplyActionsContext.Provider>);
    fireEvent.focus(await screen.findByRole('button', { name: /定位引用/ }));
    const details = await screen.findByLabelText(/引用详情：/);
    // jsdom has no viewport layout for Floating UI's hide-when-detached visibility.
    fireEvent.click(within(details).getByText('定位原文'));
    expect(nav.openSource).toHaveBeenCalledExactlyOnceWith(source);
    await waitFor(() => expect(screen.queryByLabelText(/引用详情：/)).toBeNull());
  });

  it('opens note references in their note surface and keeps tags as preview-only filters', async () => {
    const nav = actions();
    const note = { ...mention, kind: 'note' as const, id: 'note:n1', contentId: 'n1', contentTitle: '阅读笔记', label: '阅读笔记' };
    const view = render(<AssistantReplyActionsContext.Provider value={nav}><AssistantMentionChip mention={note} /></AssistantReplyActionsContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /定位引用/ }));
    expect(nav.openContext).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'n1', contentKind: 'note', entryId: 'paper' }));
    expect(nav.openSource).not.toHaveBeenCalled();
    view.rerender(<AssistantReplyActionsContext.Provider value={nav}><AssistantMentionChip mention={{ ...mention, kind: 'tag', tagName: 'Topic' }} /></AssistantReplyActionsContext.Provider>);
    expect(screen.queryByRole('button', { name: /定位引用/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /查看引用/ }));
    expect((await screen.findByLabelText(/引用详情：/)).textContent).toContain('标签用于限定');
  });
});

describe('sent reference interaction', () => {
  it('restores inline context markers as read-only chips without duplicating their summary', async () => {
    const open = vi.fn();
    render(<ChatMessage message={message('请解释 [C1] 的方法。', [{ type: 'context-snapshot', items: [item], composer: draft.snapshot }])} streaming={false} onOpenSource={open} />);
    const trigger = screen.getByRole('button', { name: /定位引用/ });
    expect(screen.queryByText('引用资料')).toBeNull();
    expect(screen.queryByRole('button', { name: /移除引用/ })).toBeNull();
    expect((await preview(trigger)).textContent).toContain('END OF EVIDENCE');
    fireEvent.click(trigger);
    expect(open).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('supports old context snapshots and pending external attachments through the same source target', async () => {
    const nav = actions(); const remove = vi.fn();
    const view = render(<AssistantReplyActionsContext.Provider value={nav}><AssistantExternalContextItems items={[item]} onRemove={remove} /></AssistantReplyActionsContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /移除引用/ }));
    expect(remove).toHaveBeenCalledExactlyOnceWith(item.id);
    expect(nav.openSource).not.toHaveBeenCalled();
    view.unmount();
    render(<ChatMessage message={message('请解释这段话', [{ type: 'context', items: [item] }])} streaming={false} onOpenSource={nav.openSource} />);
    const trigger = screen.getByRole('button', { name: /定位引用/ });
    expect((await preview(trigger)).textContent).toContain('END OF EVIDENCE');
    fireEvent.click(trigger);
    expect(nav.openSource).toHaveBeenCalledWith(source);
    expect(screen.queryByRole('button', { name: /移除引用/ })).toBeNull();
  });

  it('previews source citations and preserves their direct click behavior', async () => {
    const open = vi.fn();
    render(<ChatMessage message={{ ...message('结论 [S1]。', [], 'assistant'), source_links: [source] }} streaming={false} onOpenSource={open} />);
    const trigger = screen.getByRole('button', { name: /来源 S1/ });
    expect((await preview(trigger)).textContent).toContain('END OF EVIDENCE');
    fireEvent.click(trigger);
    expect(open).toHaveBeenCalledExactlyOnceWith(source);
    expect(screen.queryByRole('button', { name: /移除引用/ })).toBeNull();
  });

  it('keeps literal unknown markers and code samples as text', () => {
    render(<ChatMessage message={message('未知 [C9] 和示例 `[C1]`', [{ type: 'context-snapshot', items: [], composer: draft.snapshot }])} streaming={false} onOpenSource={vi.fn()} />);
    expect(screen.getByText('[C9]')).toBeTruthy();
    expect(screen.getByText('[C1]').tagName).toBe('CODE');
    expect(screen.queryByRole('button', { name: /定位引用/ })).toBeNull();
  });

  it('keeps a summary reference when its marker occurs only inside code or an ordinary link', () => {
    render(<ChatMessage message={message('示例 `[C1]` 和 [[C1]](https://example.com)', [{ type: 'context-snapshot', items: [item], composer: draft.snapshot }])} streaming={false} onOpenSource={vi.fn()} />);
    expect(screen.getByText('引用资料')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /定位引用/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '[C1]' }).getAttribute('href')).toBe('https://example.com/');
    expect(screen.queryByRole('button', { name: /移除引用/ })).toBeNull();
  });
});
