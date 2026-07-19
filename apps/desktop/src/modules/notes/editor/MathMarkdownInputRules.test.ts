/** @vitest-environment jsdom */

import { Editor } from '@tiptap/core';
import Mathematics from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

import { MathMarkdownInputRules } from './MathMarkdownInputRules';

describe('MathMarkdownInputRules', () => {
  it('replaces a three-line $$ formula with the official blockMath node', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Mathematics, MathMarkdownInputRules],
      content: ''
    });
    editor.commands.setContent('<p>$$</p><p>x^2 + y^2</p><p>$$</p>');
    expect(blockMathLatex(editor)).toEqual(['x^2 + y^2']);
    expect(editor.state.doc.textContent).not.toContain('$$');
    editor.destroy();
  });

  it('removes delimiters around a formula node left by the editor input path', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Mathematics, MathMarkdownInputRules],
      content: ''
    });
    editor.commands.setContent({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '$$' }] },
          { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
          { type: 'paragraph', content: [{ type: 'text', text: '$$' }] }
        ]
    });

    expect(blockMathLatex(editor)).toEqual(['E = mc^2']);
    expect(editor.state.doc.textContent).not.toContain('$$');
    editor.destroy();
  });

  it('loads and saves $$ Markdown through one official blockMath node', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Mathematics, Markdown],
      content: '$$\nx^2 + y^2\n$$',
      contentType: 'markdown'
    });

    expect(editor.getJSON()).toEqual({
      type: 'doc',
      content: [{ type: 'blockMath', attrs: { latex: 'x^2 + y^2' } }]
    });
    expect(editor.getMarkdown()).toBe('$$\nx^2 + y^2\n$$');
    editor.destroy();
  });
});

function blockMathLatex(editor: Editor) {
  const formulas: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'blockMath') formulas.push(String(node.attrs.latex));
  });
  return formulas;
}
