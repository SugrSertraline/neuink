/** @vitest-environment jsdom */

import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';

import { insertStructuredMarkdownPaste, tableFromText } from './structuredMarkdownPaste';

describe('structured Markdown paste', () => {
  it('converts Markdown and tabular clipboard data into table rows', () => {
    expect(tableFromText('| 名称 | 数量 |\n| --- | ---: |\n| 苹果 | 2 |')).toEqual({
      rows: [
        ['名称', '数量'],
        ['苹果', '2'],
      ],
      withHeaderRow: true,
    });
    expect(tableFromText('名称\t数量\n苹果\t2')).toEqual({
      rows: [
        ['名称', '数量'],
        ['苹果', '2'],
      ],
      withHeaderRow: false,
    });
  });

  it('inserts block and inline formulas as math nodes without delimiters', () => {
    const { editor, insertContent } = mockEditor();

    expect(insertStructuredMarkdownPaste(editor, '$$\nE = mc^2\n$$')).toBe('block-math');
    expect(insertContent).toHaveBeenLastCalledWith([
      { type: 'blockMath', attrs: { latex: 'E = mc^2' } },
      { type: 'paragraph' },
    ]);

    expect(insertStructuredMarkdownPaste(editor, '$x_1$')).toBe('inline-math');
    expect(insertContent).toHaveBeenLastCalledWith({
      type: 'inlineMath',
      attrs: { latex: 'x_1' },
    });
  });

  it('inserts a Markdown image as an image component', () => {
    const { editor, setImage } = mockEditor();

    expect(insertStructuredMarkdownPaste(editor, '![示意图](assets/example.png)')).toBe('image');
    expect(setImage).toHaveBeenCalledWith({ alt: '示意图', src: 'assets/example.png' });
  });

  it('converts a fenced Mermaid diagram into a diagram component', () => {
    const { editor, insertContent } = mockEditor();

    expect(insertStructuredMarkdownPaste(editor, '```mermaid\ngraph TD\n  A --> B\n```')).toBe('mermaid');
    expect(insertContent).toHaveBeenCalledWith([
      { type: 'mermaidDiagram', attrs: { code: 'graph TD\n  A --> B' } },
      { type: 'paragraph' },
    ]);
  });
});

function mockEditor() {
  const insertContent = vi.fn();
  const setImage = vi.fn();
  const run = vi.fn();
  const chain = {
    focus: () => chain,
    insertContent: (content: unknown) => {
      insertContent(content);
      return chain;
    },
    run,
    setImage: (image: unknown) => {
      setImage(image);
      return chain;
    },
  };
  return {
    editor: { chain: () => chain } as unknown as Editor,
    insertContent,
    setImage,
  };
}
