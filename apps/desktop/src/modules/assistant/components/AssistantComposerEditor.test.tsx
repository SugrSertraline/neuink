// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantComposerEditor, type AssistantComposerDraft } from './AssistantComposerEditor';

afterEach(cleanup);

describe('AssistantComposerEditor draft restoration', () => {
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
