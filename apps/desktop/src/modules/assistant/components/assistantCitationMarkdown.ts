import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { AssistantComposerMention } from '@/shared/types/assistant';

type MarkdownAstNode = {
  children?: MarkdownAstNode[];
  type?: string;
  url?: string;
  value?: string;
};

export function remarkSourceCitations() {
  return (tree: MarkdownAstNode) => transformCitationTextNodes(tree, { current: 0 });
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Only hide summary references actually rendered as chips, never those inside code or links. */
export function inlineContextMentionIds(markdown: string, mentions?: AssistantComposerMention[]) {
  if (!mentions?.length) return new Set<string>();
  const tree = parser.parse(markdown) as MarkdownAstNode;
  transformCitationTextNodes(tree, { current: 0 });
  const markers = new Set<string>();
  const collect = (node: MarkdownAstNode) => {
    const marker = node.url?.match(/^#neuink-context-(C[1-9]\d*)-O\d+$/)?.[1];
    if (marker) markers.add(marker);
    node.children?.forEach(collect);
  };
  collect(tree);
  return new Set(mentions.filter(mention => markers.has(mention.marker.replace(/^\[|\]$/g, ''))).map(mention => mention.id));
}

function transformCitationTextNodes(node: MarkdownAstNode, occurrence: { current: number }) {
  if (!node.children || ['link', 'linkReference', 'code', 'inlineCode'].includes(node.type ?? '')) return;
  const transformed: MarkdownAstNode[] = [];
  for (const child of node.children) {
    if (child.type !== 'text' || !child.value) {
      transformCitationTextNodes(child, occurrence);
      transformed.push(child);
      continue;
    }
    const expression = /\[([SC])([1-9]\d*)\]/g;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(child.value)) !== null) {
      if (match.index > cursor) transformed.push({ type: 'text', value: child.value.slice(cursor, match.index) });
      const kind = match[1], marker = Number(match[2]);
      occurrence.current += 1;
      transformed.push({ children: [{ type: 'text', value: `${kind}${marker}` }], type: 'link',
        url: `#neuink-${kind === 'S' ? 'source' : 'context'}-${kind}${marker}-O${occurrence.current}` });
      cursor = expression.lastIndex;
    }
    if (cursor < child.value.length) transformed.push({ type: 'text', value: child.value.slice(cursor) });
  }
  node.children = transformed;
}
