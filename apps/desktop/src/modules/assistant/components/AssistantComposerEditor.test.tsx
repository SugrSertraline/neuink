// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  if (rangeRectsDescriptor) Object.defineProperty(Range.prototype, 'getClientRects', rangeRectsDescriptor);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

describe('AssistantComposerEditor draft restoration', () => {
  it('centers the empty hint within the editable area and removes it for a restored draft', () => {
    const empty = render(<AssistantComposerEditor {...editorProps(textDraft(''))} composerDraft={null} />);
    const placeholder = empty.container.querySelector('[data-composer-placeholder]');
    expect(placeholder?.parentElement?.className).toContain('relative');
    expect(placeholder?.className).toContain('items-center');
    expect(placeholder?.className).toContain('justify-center');
    expect(placeholder?.className).toContain('inset-x-3');
    expect(placeholder?.className).toContain('text-[11px]');
    empty.unmount();

    const filled = render(<AssistantComposerEditor {...editorProps(textDraft('已有问题'))} />);
    expect(filled.container.querySelector('[data-composer-placeholder]')).toBeNull();
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

  it('restores an explicitly selected @ Entry as an inline token', () => {
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
    expect(view.container.querySelector('[data-context-mention]')?.textContent).toContain('Paper Alpha');
  });

  it('restores an explicitly selected @ Tag as an inline search scope', () => {
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
    expect(view.container.querySelector('[data-context-mention]')?.textContent).toContain('Methods');
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
