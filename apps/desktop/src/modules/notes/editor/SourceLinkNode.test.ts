/** @vitest-environment jsdom */

import { Editor as TiptapEditor } from '@tiptap/core';
import Mathematics from '@tiptap/extension-mathematics';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';

import type { SourceLink } from '@/shared/types/domain';
import {
  dematerializeMarkdownSourceLinks,
  getMarkdownWithSourceLinks,
  insertSourceLinkNode,
  materializeMarkdownSourceLinks,
  normalizeSourceLinkMarkers,
  repairKnownSourceLinkMarkers,
  sourceLinkAnchorIdFromMathLatex
} from './SourceLinkNode';
import { MathMarkdownInputRules } from './MathMarkdownInputRules';
import { SourceLinkNode } from './SourceLinkNode';

describe('insertSourceLinkNode', () => {
  it('inserts a structured sourceLink atom instead of Markdown that math can capture', () => {
    const insertContent = vi.fn(() => chain);
    const chain = {
      focus: vi.fn(() => chain),
      insertContent,
      run: vi.fn(() => true)
    };
    const editor = { chain: () => chain } as unknown as Editor;
    const link = sourceLink('$E = mc^2$ and \\[x + y\\]');

    insertSourceLinkNode(editor, link, 'C:/workspace');

    expect(insertContent).toHaveBeenCalledWith([
      { type: 'text', text: ' ' },
      {
        type: 'sourceLink',
        attrs: expect.objectContaining({
          anchorId: 'sl-test',
          snapshotText: '$E = mc^2$ and \\[x + y\\]',
          workspaceRoot: 'C:/workspace'
        })
      }
    ]);
    expect(insertContent).not.toHaveBeenCalledWith(expect.any(String));
  });
});

describe('materializeMarkdownSourceLinks', () => {
  it('escapes math delimiters in exported source excerpts', () => {
    const markdown = materializeMarkdownSourceLinks('Claim [^sl-test]\n', [
      sourceLink('$E = mc^2$ and \\[x + y\\]')
    ]);

    expect(markdown).toContain('\\$E = mc^2\\$');
    expect(markdown).toContain('\\\\\\[x + y\\\\\\]');
    expect(markdown).not.toContain('"$E = mc^2$');
  });
});

describe('repairKnownSourceLinkMarkers', () => {
  it('repairs legacy source anchors captured as block or inline math', () => {
    const link = sourceLink('Evidence');
    expect(repairKnownSourceLinkMarkers('Before \\[\\^sl-test\\] after', [link]))
      .toBe('Before [^sl-test] after');
    expect(repairKnownSourceLinkMarkers('$$\n\\^sl-test\n$$', [link]))
      .toBe('[^sl-test]');
    expect(repairKnownSourceLinkMarkers('$\\^sl-test$', [link]))
      .toBe('[^sl-test]');
  });

  it('repairs the escaped-bracket form produced by the Markdown serializer', () => {
    expect(repairKnownSourceLinkMarkers('\\[^sl-test\\]', [sourceLink('Evidence')]))
      .toBe('[^sl-test]');
    expect(normalizeSourceLinkMarkers('\\[^sl-test\\]'))
      .toBe('[^sl-test]');
  });

  it('repairs real anchors whose underscores were escaped during serialization', () => {
    const link = sourceLink('Evidence', 'sl-ZcnR5ZU8_ytzo5fs');
    expect(repairKnownSourceLinkMarkers('\\[^sl-ZcnR5ZU8\\_ytzo5fs\\]', [link]))
      .toBe('[^sl-ZcnR5ZU8_ytzo5fs]');
  });

  it('does not rewrite normal formulas or unknown anchors', () => {
    const markdown = '$$\nx^2 + y^2\n$$\n\n\\[\\^sl-other\\]';
    expect(repairKnownSourceLinkMarkers(markdown, [sourceLink('Evidence')])).toBe(markdown);
  });

  it('repairs before stripping materialized source footnotes on editor load', () => {
    const result = dematerializeMarkdownSourceLinks(
      '\\[\\^sl-test\\]\n\n## Sources\n\n[^sl-test]: p.1\n',
      [sourceLink('Evidence')]
    );
    expect(result).toBe('[^sl-test]\n');
  });
});

describe('sourceLinkAnchorIdFromMathLatex', () => {
  it('recognizes source anchors already parsed into math nodes', () => {
    expect(sourceLinkAnchorIdFromMathLatex('^sl-VHhPgBj2hhJ675yG'))
      .toBe('sl-VHhPgBj2hhJ675yG');
    expect(sourceLinkAnchorIdFromMathLatex('\\^sl-ZcnR5ZU8\\_ytzo5fs'))
      .toBe('sl-ZcnR5ZU8_ytzo5fs');
    expect(sourceLinkAnchorIdFromMathLatex('x^2 + y^2')).toBeNull();
  });
});

describe('source link Markdown integration', () => {
  it('parses a persisted reference beside formulas into a sourceLink atom', () => {
    const editor = markdownEditor();
    editor.commands.setContent('公式 $E = mc^2$ 后的引用 [^sl-test]\n\n$$\nx^2 + y^2\n$$', {
      contentType: 'markdown'
    });

    const sourceLinks: Array<{ anchorId: string }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'sourceLink') {
        sourceLinks.push({ anchorId: String(node.attrs.anchorId ?? '') });
      }
    });

    expect(sourceLinks).toEqual([{ anchorId: 'sl-test' }]);
    expect(editor.getJSON().content?.some((node) => node.type === 'blockMath')).toBe(true);
    editor.destroy();
  });

  it('serializes sourceLink atoms without temporarily replacing editor content', () => {
    const editor = markdownEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '结论 ' },
            { type: 'sourceLink', attrs: { anchorId: 'sl-test' } }
          ]
        }
      ]
    });
    const before = editor.getJSON();

    expect(getMarkdownWithSourceLinks(editor)).toContain('[^sl-test]');
    expect(editor.getJSON()).toEqual(before);
    editor.destroy();
  });
});

function markdownEditor(content: string | Record<string, unknown> = '') {
  return new TiptapEditor({
    element: document.createElement('div'),
    extensions: [StarterKit, Mathematics, MathMarkdownInputRules, Markdown, SourceLinkNode],
    content,
    contentType: typeof content === 'string' ? 'markdown' : undefined
  });
}

function sourceLink(snapshotText: string, anchorId = 'sl-test'): SourceLink {
  return {
    anchor_id: anchorId,
    created_at: '',
    display_text: 'p.1',
    link_id: 'link-test',
    owner: { entry_id: 'note-entry', kind: 'note', note_id: 'note-1' },
    sources: [{
      entry_id: 'paper-entry', page: 1, quote_hash: '', segment_uid: 'segment-1',
      snapshot_text: snapshotText
    }]
  };
}
