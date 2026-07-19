import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Code2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { MermaidDiagramPreview } from '@/shared/components/MermaidDiagramPreview';

type MermaidMarkdownToken = {
  attributes?: { code?: string };
  raw?: string;
  type: string;
};

export const MermaidDiagram = Node.create({
  name: 'mermaidDiagram',

  group: 'block',

  atom: true,

  isolating: true,

  draggable: true,

  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-mermaid-code') ?? '',
        renderHTML: (attributes: { code?: string }) => ({
          'data-mermaid-code': attributes.code ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'neuink-mermaid' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['neuink-mermaid', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidDiagramView);
  },

  parseMarkdown: (token: MermaidMarkdownToken, helpers: MarkdownParseHelpers) =>
    helpers.createNode('mermaidDiagram', { code: token.attributes?.code ?? '' }),

  renderMarkdown: (node: JSONContent, _helpers: MarkdownRendererHelpers) => {
    const code = String(node.attrs?.code ?? '').trim();
    return `\`\`\`mermaid\n${code}\n\`\`\``;
  },

  markdownTokenizer: {
    name: 'mermaidDiagram',
    level: 'block',
    start(src: string) {
      const match = src.match(/^```mermaid[ \t]*(?:\r?\n|$)/m);
      return match?.index ?? -1;
    },
    tokenize(src: string) {
      const match = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/.exec(src);
      if (!match) {
        return undefined;
      }
      return {
        attributes: { code: match[1] ?? '' },
        raw: match[0],
        type: 'mermaidDiagram',
      };
    },
  },
} as Record<string, unknown>);

function MermaidDiagramView({ node, updateAttributes }: NodeViewProps) {
  const code = String(node.attrs.code ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);

  useEffect(() => {
    if (!editing) {
      setDraft(code);
    }
  }, [code, editing]);

  return (
    <NodeViewWrapper
      className="not-prose my-4 overflow-hidden rounded-lg border bg-card shadow-sm"
      contentEditable={false}
      data-mermaid-diagram="true"
    >
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Code2 size={14} aria-hidden="true" />
        <span className="font-medium text-foreground">Mermaid 图</span>
        <button
          className="ml-auto rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
          type="button"
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? '预览' : '编辑源码'}
        </button>
      </div>
      {editing ? (
        <div className="grid gap-2 p-3">
          <textarea
            aria-label="Mermaid 源代码"
            className="min-h-40 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                updateAttributes({ code: draft });
                setEditing(false);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setDraft(code);
                setEditing(false);
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              className="rounded-md px-2 py-1 text-xs hover:bg-muted"
              type="button"
              onClick={() => {
                setDraft(code);
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground"
              type="button"
              onClick={() => {
                updateAttributes({ code: draft });
                setEditing(false);
              }}
            >
              保存源码
            </button>
          </div>
        </div>
      ) : (
        <MermaidDiagramPreview className="m-3" code={code} />
      )}
    </NodeViewWrapper>
  );
}
