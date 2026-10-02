import { MarkdownManager } from '@tiptap/markdown';
import { buildNoteReviewDiff, type NoteReviewBlock } from './noteReviewDiff';

const markdown = new MarkdownManager({ extensions: [] });

/** Diff complete Markdown blocks, never fragments of fences, lists or tables. */
export function buildRenderedNoteDiff(before: string, after: string): NoteReviewBlock[] {
  const tokenize = (value: string) => {
    if (!value) return [];
    // Definitions and display math can span blocks or affect other blocks.
    if (/^ {0,3}\[[^\]]+\]:|\$\$|\\\[/m.test(value)) return [value];
    const tokens = markdown.instance.lexer(value);
    if (tokens.map(token => token.raw).join('') !== value) return [value];
    return tokens.filter(token => token.type !== 'space').map(token => token.raw.trimEnd());
  };
  const left = tokenize(before);
  const right = tokenize(after);
  // One encoded block per diff unit reuses the bounded LCS engine.
  const encoded = buildNoteReviewDiff(left.map(value => JSON.stringify(value)).join('\n'), right.map(value => JSON.stringify(value)).join('\n'));
  const decode = (value: string) => value ? value.split('\n').map(line => JSON.parse(line) as string).join('\n\n') : '';
  const blocks: NoteReviewBlock[] = encoded.map(block => block.kind === 'context'
    ? { kind: 'context', text: decode(block.text) }
    : { ...block, before: decode(block.before), after: decode(block.after) });
  // Whitespace-only edits must remain reviewable, not presented as a no-op.
  if (before !== after && !blocks.some(block => block.kind === 'change')) {
    return [{ kind: 'change', id: 0, before, after, beforeLine: 1, afterLine: 1, beforeCount: before ? 1 : 0, afterCount: after ? 1 : 0 }];
  }
  return blocks;
}
