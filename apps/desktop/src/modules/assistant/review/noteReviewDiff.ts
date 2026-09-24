import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { applyMarkdownPatchPreview } from '../sdk/toolSupport';

export type NoteReviewBlock =
  | { kind: 'context'; text: string }
  | { kind: 'change'; id: number; before: string; after: string; beforeLine: number; afterLine: number; beforeCount: number; afterCount: number };

export function noteReviewVersions(proposal: AssistantNoteProposal) {
  if (proposal.targetKind === 'segment_note') throw new Error('片段记录请在对话中审阅。');
  if (proposal.action !== 'create' && proposal.beforeMarkdown == null) {
    throw new Error('这条修改缺少原文快照，无法可靠对比。请返回对话重新生成修改。');
  }
  const before = proposal.action === 'create' ? '' : proposal.beforeMarkdown!;
  // Match the authoritative operation, never treat a patch summary as note content.
  const after = proposal.action === 'patch' || proposal.action === 'delete'
    ? applyMarkdownPatchPreview(before, proposal.patchOperations ?? [])
    : proposal.action === 'append'
      ? [before.trimEnd(), proposal.markdown.trim()].filter(Boolean).join('\n\n')
      : proposal.action === 'prepend'
        ? [proposal.markdown.trim(), before.trimStart()].filter(Boolean).join('\n\n')
        : proposal.markdown;
  return { before, after };
}

/** Bounded line diff; very large changed regions remain one exact, untruncated change. */
export function buildNoteReviewDiff(before: string, after: string): NoteReviewBlock[] {
  const lines = (value: string) => value.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const a = before ? lines(before) : [];
  const b = after ? lines(after) : [];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const left = a.slice(prefix, a.length - suffix);
  const right = b.slice(prefix, b.length - suffix);
  const operations: Array<{ kind: 'same' | 'remove' | 'add'; text: string }> =
    a.slice(0, prefix).map(text => ({ kind: 'same', text }));
  if ((left.length + 1) * (right.length + 1) > 500_000) {
    left.forEach(text => operations.push({ kind: 'remove', text }));
    right.forEach(text => operations.push({ kind: 'add', text }));
  } else {
    const width = right.length + 1;
    const lcs = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
      lcs[i * width + j] = left[i] === right[j] ? 1 + lcs[(i + 1) * width + j + 1]
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
    let i = 0; let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        operations.push({ kind: 'same', text: left[i++] }); j++;
      } else if (i < left.length && (j === right.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
        operations.push({ kind: 'remove', text: left[i++] });
      } else operations.push({ kind: 'add', text: right[j++] });
    }
  }
  a.slice(a.length - suffix).forEach(text => operations.push({ kind: 'same', text }));
  const blocks: NoteReviewBlock[] = [];
  let beforeLine = 1; let afterLine = 1; let changes = 0;
  for (let index = 0; index < operations.length;) {
    const context = operations[index].kind === 'same';
    const startBefore = beforeLine; const startAfter = afterLine;
    const old: string[] = []; const next: string[] = [];
    while (index < operations.length && (operations[index].kind === 'same') === context) {
      const op = operations[index++];
      if (op.kind !== 'add') { old.push(op.text); beforeLine++; }
      if (op.kind !== 'remove') { next.push(op.text); afterLine++; }
    }
    blocks.push(context ? { kind: 'context', text: old.join('\n') }
      : { kind: 'change', id: changes++, before: old.join('\n'), after: next.join('\n'), beforeLine: startBefore, afterLine: startAfter, beforeCount: old.length, afterCount: next.length });
  }
  return blocks;
}
