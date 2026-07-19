import type { AssistantNoteProposal } from '@/shared/types/assistant';

export type NoteProposalPreviewModel =
  | { kind: 'change'; label: 'Added' | 'Removed'; text: string; tone: 'after' | 'before' }
  | { after: string; before: string; kind: 'diff' }
  | { kind: 'markdown'; text: string };

export function buildNoteProposalPreview(
  proposal: AssistantNoteProposal
): NoteProposalPreviewModel {
  if (proposal.action === 'append' || proposal.action === 'prepend') {
    return { kind: 'change', label: 'Added', text: proposal.markdown, tone: 'after' };
  }

  const removed = removedMarkdown(proposal);
  if (removed !== null) {
    return { kind: 'change', label: 'Removed', text: removed, tone: 'before' };
  }

  if (proposal.beforeMarkdown !== undefined && proposal.afterMarkdown !== undefined) {
    return {
      ...buildDiffPreview(proposal.beforeMarkdown ?? '', proposal.afterMarkdown ?? ''),
      kind: 'diff'
    };
  }

  return { kind: 'markdown', text: proposal.markdown };
}

function removedMarkdown(proposal: AssistantNoteProposal) {
  const operations = proposal.patchOperations ?? [];
  if (
    operations.length > 0 &&
    operations.every(
      (operation) => operation.type === 'replace_exact' && operation.newText.length === 0
    )
  ) {
    return operations
      .map((operation) => operation.type === 'replace_exact' ? operation.oldText : '')
      .join('\n\n');
  }

  if (
    proposal.beforeMarkdown &&
    proposal.afterMarkdown !== undefined &&
    !(proposal.afterMarkdown ?? '').trim()
  ) {
    return proposal.beforeMarkdown;
  }
  if (proposal.beforeMarkdown && proposal.afterMarkdown !== undefined) {
    return removedSubsequence(proposal.beforeMarkdown, proposal.afterMarkdown ?? '');
  }
  return null;
}

function removedSubsequence(before: string, after: string) {
  let afterIndex = 0;
  let removed = '';
  for (const character of before) {
    if (character === after[afterIndex]) {
      afterIndex += 1;
    } else {
      removed += character;
    }
  }
  if (afterIndex !== after.length || removed.length === 0) return null;
  return removed.trim();
}

function buildDiffPreview(beforeMarkdown: string, afterMarkdown: string) {
  const beforeLines = splitMarkdownLines(beforeMarkdown);
  const afterLines = splitMarkdownLines(afterMarkdown);
  let start = 0;

  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  if (start === beforeLines.length && start === afterLines.length) {
    return {
      after: compactDiffText(afterLines.join('\n')),
      before: compactDiffText(beforeLines.join('\n'))
    };
  }

  return {
    after: diffSlice(afterLines, start, afterEnd, 3),
    before: diffSlice(beforeLines, start, beforeEnd, 3)
  };
}

function diffSlice(lines: string[], start: number, end: number, context: number) {
  if (lines.length === 0) return '';
  const from = Math.max(0, start - context);
  const to = Math.min(lines.length - 1, Math.max(end, start - 1) + context);
  const body = lines.slice(from, to + 1);
  return compactDiffText([
    ...(from > 0 ? ['...'] : []),
    ...body,
    ...(to < lines.length - 1 ? ['...'] : [])
  ].join('\n'));
}

function splitMarkdownLines(markdown: string) {
  const trimmed = markdown.trimEnd();
  return trimmed ? trimmed.split(/\r?\n/) : [];
}

function compactDiffText(text: string) {
  return text.length > 3_000 ? `${text.slice(0, 3_000)}\n...` : text;
}
