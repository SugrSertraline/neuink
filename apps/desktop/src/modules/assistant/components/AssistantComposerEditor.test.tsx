// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { pdfBlockDrag, type PdfBlockDragItem } from '@/shared/lib/pdfBlockDrag';
import { listItemSegments } from '@/shared/lib/listItemSegments';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistantComposerEditor, findInlineMention, type AssistantComposerDraft } from './AssistantComposerEditor';

const rangeRectsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(224);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(384);
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  // jsdom has no Range layout; provide a bounded selection rectangle.
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => {
    const rect = new DOMRect(0, 0, 1, 1);
    return { 0: rect, length: 1, item: () => rect };
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  pdfBlockDrag.cancel();
  if (rangeRectsDescriptor) Object.defineProperty(Range.prototype, 'getClientRects', rangeRectsDescriptor);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

const dropEntry = { id: 'drop-paper', title: '拖入的论文', contents: [], tagIds: [], tags: [], fields: {},
  createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf', parseMessage: null, parseEndpoint: null,
  status: 'Parsed' as const, progress: 100 };
const block: PdfBlockDragItem = {
  entryId: dropEntry.id, workspaceRoot: 'library-a', bbox: [100, 100, 800, 400],
  segment: { uid: 'block-4', bbox: [100, 100, 800, 400], page_idx: 3, segment_type: 'paragraph', text: 'Exact block evidence.', markdown: '**Exact** block evidence.' } as PdfBlockDragItem['segment'],
};

describe('PDF block attachments', () => {
  it('retains two sibling list references separately and deduplicates only the same item', async () => {
    const onChange = vi.fn();
    const view = render(<AssistantComposerEditor {...editorProps(textDraft('比较这两项'))} entries={[dropEntry]} workspaceRoot="library-a" onChange={onChange} />);
    const target = view.container.querySelector('[data-material="composer"]') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 100, 300, 250));
    const items = listItemSegments({ ...block.segment, uid: 'list', segment_type: 'list', markdown: '- Alpha\n- Beta', text: 'Alpha\nBeta' });
    for (const segment of [items[0], items[1], items[0]]) {
      act(() => { pdfBlockDrag.begin({ ...block, segment }, 600, 200); pdfBlockDrag.finish(600, 200); });
    }
    await waitFor(() => expect(view.container.querySelectorAll('[data-context-mention]')).toHaveLength(2));
    expect(onChange.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ segmentUid: 'list:list-item:0', text: 'Alpha' }),
      expect.objectContaining({ segmentUid: 'list:list-item:1', text: 'Beta' }),
    ]);
  });
  it('adds exact evidence inline without replacing the question or submitting, deduplicates, and restores the attachment', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const props = { ...editorProps(textDraft('请解释这段话 ')), entries: [dropEntry], workspaceRoot: 'library-a', onChange, onSubmit };
    const view = render(<AssistantComposerEditor {...props} />);
    const target = view.container.querySelector('[data-material="composer"]') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 100, 300, 250));
    act(() => { pdfBlockDrag.begin(block, 600, 200); });
    expect(target.dataset.blockDropActive).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('松开鼠标，加入此片段');
    act(() => { pdfBlockDrag.finish(600, 200); });
    expect(screen.queryByRole('status')).toBeNull();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const [snapshot, items, document] = onChange.mock.lastCall!;
    expect(snapshot.text).toContain('请解释这段话');
    expect(items).toEqual([expect.objectContaining({ kind: 'segment', entryId: dropEntry.id, entryTitle: dropEntry.title,
      pageIdx: 3, segmentUid: 'block-4', text: '**Exact** block evidence.' })]);
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => { pdfBlockDrag.begin(block, 600, 200); pdfBlockDrag.finish(600, 200); });
    expect(view.container.querySelectorAll('[data-context-mention]')).toHaveLength(1);
    view.unmount();
    const restored = render(<AssistantComposerEditor {...props} composerDraft={{ document, snapshot }} />);
    await waitFor(() => expect(restored.container.querySelector('[data-context-mention]')?.textContent).toContain('第 4 页'));
    // Editing restored content serializes the original text and page as well.
    fireEvent.keyDown(restored.container.querySelector('.ProseMirror')!, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(document.content.flatMap((p: any) => p.content).find((n: any) => n.type === 'contextMention').attrs)
      .toMatchObject({ text: '**Exact** block evidence.', pageIdx: 3 });
  });

  it.each(['disabled', 'other-library', 'missing-entry', 'outside', 'empty', 'cancelled'] as const)('rejects a %s drop without changing the draft', kind => {
    const onChange = vi.fn();
    const view = render(<AssistantComposerEditor {...editorProps(textDraft('保留草稿'))} entries={kind === 'missing-entry' ? [] : [dropEntry]}
      workspaceRoot={kind === 'other-library' ? 'library-b' : 'library-a'} disabled={kind === 'disabled'} onChange={onChange} />);
    const target = view.container.querySelector('[data-material="composer"]') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 100, 300, 250));
    onChange.mockClear();
    act(() => {
      pdfBlockDrag.begin(kind === 'empty' ? { ...block, segment: { ...block.segment, text: '', markdown: null } } : block, 600, 200);
      if (kind === 'cancelled') pdfBlockDrag.cancel();
      pdfBlockDrag.finish(kind === 'outside' ? 300 : 600, 200);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(view.container.querySelector('.ProseMirror')?.textContent).toBe('保留草稿');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows feedback only over a valid target and clears it on leave, cancellation and disabling', () => {
    const onChange = vi.fn();
    const props = { ...editorProps(textDraft('保留问题')), entries: [dropEntry], workspaceRoot: 'library-a', onChange };
    const view = render(<AssistantComposerEditor {...props} />);
    const target = view.container.querySelector('[data-material="composer"]') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 100, 300, 250));
    onChange.mockClear();
    act(() => { pdfBlockDrag.begin(block, 300, 200); });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { pdfBlockDrag.update(600, 200); });
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => { pdfBlockDrag.update(300, 200); });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { pdfBlockDrag.update(600, 200); pdfBlockDrag.cancel(); });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { pdfBlockDrag.begin(block, 600, 200); });
    view.rerender(<AssistantComposerEditor {...props} disabled />);
    expect(screen.queryByRole('status')).toBeNull();
    onChange.mockClear();
    act(() => { pdfBlockDrag.finish(600, 200); });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '输入问题' }).textContent).toBe('保留问题');
  });

  it('restores an attachment-only draft without an extra input cue or placeholder', async () => {
    const onChange = vi.fn();
    const view = render(<AssistantComposerEditor {...editorProps(textDraft(''))} composerDraft={null}
      entries={[dropEntry]} workspaceRoot="library-a" onChange={onChange} />);
    const target = view.container.querySelector('[data-material="composer"]') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 100, 300, 250));
    act(() => { pdfBlockDrag.begin(block, 600, 200); pdfBlockDrag.finish(600, 200); });
    await waitFor(() => expect(view.container.querySelector('[data-context-mention]')).not.toBeNull());
    expect(screen.queryByText('已添加引用，继续输入问题')).toBeNull();
    expect(screen.queryByText('输入问题', { exact: true })).toBeNull();
    expect(view.container.querySelector('[data-composer-placeholder]')).toBeNull();
    const [snapshot, , document] = onChange.mock.lastCall!;
    expect(snapshot.text.trim()).toBe('[C1]');
    view.unmount();
    const restored = render(<AssistantComposerEditor {...editorProps({ document, snapshot })} entries={[dropEntry]} workspaceRoot="library-a" />);
    await waitFor(() => expect(restored.container.querySelector('[data-context-mention]')).not.toBeNull());
    expect(restored.container.querySelector('[data-composer-placeholder]')).toBeNull();
  });
});

describe('AssistantComposerEditor draft restoration', () => {
  it('labels the multiline input, keeps the empty hint while focused and removes it for a restored draft', () => {
    const empty = render(<AssistantComposerEditor {...editorProps(textDraft(''))} composerDraft={null} />);
    const input = screen.getByRole('textbox', { name: '输入问题' });
    expect(input.getAttribute('aria-multiline')).toBe('true');
    fireEvent.focus(input);
    expect(empty.container.querySelector('[data-composer-placeholder]')?.textContent).toContain('输入问题');
    empty.unmount();

    const filled = render(<AssistantComposerEditor {...editorProps(textDraft('已有问题'))} />);
    expect(filled.container.querySelector('[data-composer-placeholder]')).toBeNull();
  });

  it('shows an unavailable state without inviting typing when editing is disabled', () => {
    const view = render(<AssistantComposerEditor {...editorProps(textDraft('已有问题'))} disabled />);
    const input = screen.getByRole('textbox', { name: '输入问题' });
    expect(input.getAttribute('contenteditable')).toBe('false');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(view.container.querySelector('[data-composer-placeholder]')).toBeNull();
    expect(input.textContent).toBe('已有问题');
  });

  it('keeps element selection and send actions inside the composer surface', () => {
    const onSend = vi.fn();
    const view = render(<AssistantComposerEditor {...editorProps(textDraft('你好'))}
      actions={<button type="button" onClick={onSend}>发送</button>} />);
    const composer = view.container.querySelector('[data-material="composer"]');
    expect(composer).not.toBeNull();
    expect(within(composer as HTMLElement).getByRole('button', { name: '选择元素' })).toBeTruthy();
    fireEvent.click(within(composer as HTMLElement).getByRole('button', { name: '发送' }));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('adds a selected Tag and PDF as typed inline context without replacing the question text', async () => {
    const onChange = vi.fn();
    const entry = { id: 'paper', title: '论文 A', contents: [], tagIds: [], tags: [], fields: {},
      createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf', parseMessage: null, parseEndpoint: null,
      status: 'Parsed' as const, progress: 100 };
    render(<AssistantComposerEditor {...editorProps(textDraft('请整理 '))} entries={[entry]}
      tags={[{ id: 'methods', name: '方法', parent_id: null, created_at: '', updated_at: '' }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '选择元素' }));
    fireEvent.click(screen.getByRole('option', { name: /方法/ }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mentions: [expect.objectContaining({ kind: 'tag', tagId: 'methods' })] }),
      [], expect.any(Object)));
    fireEvent.click(screen.getByRole('button', { name: '选择元素' }));
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    fireEvent.click(screen.getByRole('option', { name: /paper.pdf/ }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: expect.stringContaining('请整理'), mentions: [
        expect.objectContaining({ kind: 'tag', tagId: 'methods' }),
        expect.objectContaining({ kind: 'pdf', entryId: 'paper' })
      ] }), [expect.objectContaining({ contentKind: 'pdf', entryId: 'paper' })], expect.any(Object)));
  });
  it('detects @ in prose but preserves literal email and @ text until explicitly selected', () => {
    expect(findInlineMention('请读@paper', 8)?.query).toBe('paper');
    expect(findInlineMention('me@example.com', 14)).toBeNull();
    expect(findInlineMention('请保留 @', 5)?.query).toBe('');
  });
  it('restores unsent text after the editor is unmounted and mounted again', () => {
    const draft = textDraft('This question must survive switching panels');
    const props = editorProps(draft);
    const first = render(<AssistantComposerEditor {...props} />);

    expect(first.container.querySelector('.ProseMirror')?.textContent).toContain(draft.snapshot.text);
    first.unmount();

    const second = render(<AssistantComposerEditor {...editorProps(draft)} />);
    expect(second.container.querySelector('.ProseMirror')?.textContent).toContain(draft.snapshot.text);
  });

  it('does not convert a plain Entry title into context', () => {
    const draft = textDraft('Read Paper Alpha and explain the method');
    const view = render(<AssistantComposerEditor {...editorProps(draft)} />);

    expect(view.container.querySelector('[data-context-mention]')).toBeNull();
    expect(view.container.querySelector('.ProseMirror')?.textContent).toContain(draft.snapshot.text);
  });

  it('restores an explicitly selected @ Entry as an inline token', async () => {
    const draft: AssistantComposerDraft = {
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Compare ' },
              {
                type: 'contextMention',
                attrs: {
                  contentId: null,
                  contentKind: 'entry',
                  contentTitle: null,
                  entryId: 'paper-alpha',
                  entryTitle: 'Paper Alpha',
                  id: 'entry:paper-alpha',
                  kind: 'entry',
                  label: 'Paper Alpha',
                  role: null,
                  segmentUid: null
                }
              },
              { type: 'text', text: ' with the result' }
            ]
          }
        ]
      },
      snapshot: {
        mentions: [
          {
            charOffset: 8,
            entryId: 'paper-alpha',
            entryTitle: 'Paper Alpha',
            id: 'entry:paper-alpha',
            kind: 'entry',
            label: 'Paper Alpha',
            marker: '[C1]'
          }
        ],
        text: 'Compare [C1] with the result'
      }
    };

    const view = render(<AssistantComposerEditor {...editorProps(draft)} />);
    await waitFor(() => expect(view.container.querySelector('[data-context-mention]')?.textContent).toContain('Paper Alpha'));
  });

  it('restores an explicitly selected @ Tag as an inline search scope', async () => {
    const draft: AssistantComposerDraft = {
      document: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'contextMention',
            attrs: {
              entryId: '', entryTitle: '', id: 'tag:methods', kind: 'tag',
              label: 'Methods', tagId: 'methods', tagName: 'Methods'
            }
          }, { type: 'text', text: ' compare the approaches' }]
        }]
      },
      snapshot: {
        mentions: [{
          charOffset: 0,
          entryId: '',
          entryTitle: '',
          id: 'tag:methods',
          kind: 'tag',
          label: 'Methods',
          marker: '[C1]',
          tagId: 'methods',
          tagName: 'Methods'
        }],
        text: '[C1] compare the approaches'
      }
    };

    const view = render(<AssistantComposerEditor {...editorProps(draft)} />);
    await waitFor(() => expect(view.container.querySelector('[data-context-mention]')?.textContent).toContain('Methods'));
    expect(view.container.querySelector('[data-context-mention]')?.textContent).toContain('Tag');
  });
});

function textDraft(text: string): AssistantComposerDraft {
  return {
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    },
    snapshot: { mentions: [], text }
  };
}

function editorProps(composerDraft: AssistantComposerDraft) {
  return {
    composerDraft,
    disabled: false,
    draftQuestion: null,
    entries: [],
    tags: [],
    onChange: vi.fn(),
    onDraftQuestionConsumed: vi.fn(),
    onSubmit: vi.fn(),
    resetKey: 0
  };
}
