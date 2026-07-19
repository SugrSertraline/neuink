/** @vitest-environment jsdom */

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { MermaidDiagram } from './MermaidDiagram';

describe('MermaidDiagram Markdown integration', () => {
  it('round-trips a Mermaid fenced block as a diagram node', () => {
    const editor = new Editor({
      content: '```mermaid\ngraph TD\n  A --> B\n```',
      contentType: 'markdown',
      element: document.createElement('div'),
      extensions: [StarterKit, MermaidDiagram, Markdown],
    });

    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          attrs: { code: 'graph TD\n  A --> B' },
          type: 'mermaidDiagram',
        },
      ],
    });
    expect(editor.getMarkdown()).toBe('```mermaid\ngraph TD\n  A --> B\n```');
    editor.destroy();
  });
});
