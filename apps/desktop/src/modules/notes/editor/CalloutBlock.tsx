import type { JSONContent, MarkdownParseHelpers, MarkdownRendererHelpers } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { CalloutBlockView } from './CalloutBlockView';

export type CalloutVariant = 'error' | 'info' | 'success' | 'tip' | 'warning';

type MarkdownTokenWithCallout = {
  attributes?: Record<string, unknown>;
  raw?: string;
  tokens?: unknown[];
  type: string;
};

const CALLOUT_HEADER_REGEX = /^>\s*\[!([A-Za-z0-9_-]+)\](?:\s+(.*))?\s*$/;

export const CalloutBlock = Node.create({
  name: 'calloutBlock',

  priority: 1000,

  group: 'block',

  content: 'block+',

  defining: true,
  isolating: true,

  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-title') ?? ''
      },
      variant: {
        default: 'info',
        parseHTML: (element: HTMLElement) =>
          normalizeCalloutVariant(element.getAttribute('data-variant'))
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'neuink-callout'
      }
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      'neuink-callout',
      mergeAttributes(HTMLAttributes, {
        'data-title': HTMLAttributes.title,
        'data-variant': HTMLAttributes.variant
      }),
      0
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutBlockView);
  },

  parseMarkdown: (token: MarkdownTokenWithCallout, helpers: MarkdownParseHelpers) => {
    const attrs = (token as MarkdownTokenWithCallout).attributes as
      | { title?: string; variant?: string }
      | undefined;
    const content = helpers.parseChildren((token.tokens as never[]) || []);

    return helpers.createNode(
      'calloutBlock',
      {
        title: attrs?.title ?? '',
        variant: normalizeCalloutVariant(attrs?.variant)
      },
      content
    );
  },

  renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) => {
    const variant = normalizeCalloutVariant(String(node.attrs?.variant ?? 'info'));
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title.trim() : '';
    const header = `> [!${variant.toUpperCase()}]${title ? ` ${title}` : ''}`;
    const body = helpers.renderChildren(node.content || [], '\n\n').trim();

    if (!body) {
      return `${header}\n>`;
    }

    const prefixedBody = body
      .split('\n')
      .map((line: string) => (line.trim().length === 0 ? '>' : `> ${line}`))
      .join('\n');

    return `${header}\n>\n${prefixedBody}`;
  },

  markdownTokenizer: {
    name: 'calloutBlock',
    level: 'block',
    start(src: string) {
      const match = src.match(/^>\s*\[!/m);
      return match?.index ?? -1;
    },
    tokenize(src: string, _tokens: unknown, lexer: { blockTokens: (value: string) => never[]; inlineTokens: (value: string) => never[] }) {
      const lines = src.split('\n');
      const firstLine = lines[0] ?? '';
      const headerMatch = CALLOUT_HEADER_REGEX.exec(firstLine);

      if (!headerMatch) {
        return undefined;
      }

      const blockLines: string[] = [];
      for (const line of lines) {
        if (/^>\s?/.test(line) || line === '>') {
          blockLines.push(line);
          continue;
        }
        break;
      }

      const raw = blockLines.join('\n');
      const title = (headerMatch[2] ?? '').trim();
      const variant = normalizeCalloutVariant(headerMatch[1]);
      const contentLines = blockLines.slice(1).map((line) => stripCalloutPrefix(line));

      while (contentLines[0] !== undefined && contentLines[0].trim().length === 0) {
        contentLines.shift();
      }
      while (
        contentLines.length > 0 &&
        contentLines[contentLines.length - 1] !== undefined &&
        contentLines[contentLines.length - 1]!.trim().length === 0
      ) {
        contentLines.pop();
      }

      const body = contentLines.join('\n');
      const tokens = body ? lexer.blockTokens(body) : [];

      tokens.forEach((token: { text?: string; tokens?: never[] }) => {
        if (token.text && (!token.tokens || token.tokens.length === 0)) {
          token.tokens = lexer.inlineTokens(token.text);
        }
      });

      return {
        type: 'calloutBlock',
        raw,
        attributes: {
          title,
          variant
        },
        tokens
      };
    }
  }
} as Record<string, unknown>);

function normalizeCalloutVariant(value?: string | null): CalloutVariant {
  switch (String(value || '').toLowerCase()) {
    case 'warning':
    case 'caution':
      return 'warning';
    case 'success':
    case 'done':
      return 'success';
    case 'error':
    case 'danger':
      return 'error';
    case 'tip':
    case 'hint':
      return 'tip';
    default:
      return 'info';
  }
}

function stripCalloutPrefix(line: string) {
  if (line === '>') {
    return '';
  }
  return line.replace(/^>\s?/, '');
}
