import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type {
  AssistantComposerSnapshot,
  AssistantContextItem
} from '@/shared/types/assistant';

export type ComposerBlock =
  | {
      text: string;
      type: 'text';
    }
  | {
      itemId: string;
      type: 'context';
    };

export const COMPOSER_CONTEXT_CHAR = '\uFFFC';

export function activeEntryMention(text: string) {
  const match = text.match(/(^|[\s\uFFFC])@+([^\s@\uFFFC]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index + match[1].length;
  return {
    end: text.length,
    query: match[2] ?? '',
    start
  };
}

export function normalizeComposerInputText(text: string) {
  return text.replace(/(^|[\s\uFFFC])@{2,}([^\s@\uFFFC]*)$/, '$1@$2');
}

export function activeContentMention(text: string, entries: LibraryEntry[]) {
  const at = text.lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  const tail = text.slice(at);
  const match = tail.match(/^@(.+?)\s*\[\s*([^\]\n]*)$/);
  if (!match) {
    return null;
  }
  const title = match[1].trim();
  const entry = entries.find((candidate) => candidate.title === title);
  if (!entry) {
    return null;
  }
  return {
    end: text.length,
    entry,
    query: (match[2] ?? '').trim(),
    start: at
  };
}

export function composerBlocksToText(blocks: ComposerBlock[]) {
  return blocks
    .filter((block): block is Extract<ComposerBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export function composerBlocksToLogicalText(blocks: ComposerBlock[]) {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : COMPOSER_CONTEXT_CHAR))
    .join('');
}

export function composerBlocksLogicalLength(blocks: ComposerBlock[]) {
  return blocks.reduce((total, block) => total + (block.type === 'text' ? block.text.length : 1), 0);
}

export function cloneComposerBlocks(blocks: ComposerBlock[]) {
  return blocks.map((block) => ({ ...block }));
}

export function orderedAssistantContextItems(
  items: AssistantContextItem[],
  snapshot: AssistantComposerSnapshot
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const ordered: AssistantContextItem[] = [];
  const seen = new Set<string>();
  const add = (item: AssistantContextItem | undefined) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    ordered.push({ ...item });
  };

  for (const mention of snapshot.mentions) add(itemById.get(mention.id));
  for (const item of items) add(item);
  return ordered;
}

export function externalAssistantContextItems(
  items: AssistantContextItem[],
  snapshot: AssistantComposerSnapshot
) {
  const inlineIds = new Set(snapshot.mentions.map((mention) => mention.id));
  return items.filter((item) => !inlineIds.has(item.id));
}

export function hasPersistableAssistantContext(
  items: AssistantContextItem[],
  snapshot?: AssistantComposerSnapshot | null
) {
  return items.length > 0 || (snapshot?.mentions.length ?? 0) > 0;
}

export function composerBlocksForContextItems(items: AssistantContextItem[]) {
  return normalizeComposerBlocks(
    items.flatMap((item): ComposerBlock[] => [
      { itemId: item.id, type: 'context' },
      { text: ' ', type: 'text' }
    ])
  );
}

export function normalizeComposerBlocks(blocks: ComposerBlock[]) {
  const normalized: ComposerBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      if (!block.text) {
        continue;
      }
      const previous = normalized[normalized.length - 1];
      if (previous?.type === 'text') {
        previous.text += block.text;
      } else {
        normalized.push({ ...block });
      }
      continue;
    }
    normalized.push(block);
  }
  return normalized;
}

export function composerBlocksEqual(left: ComposerBlock[], right: ComposerBlock[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((block, index) => {
    const other = right[index];
    if (!other || block.type !== other.type) {
      return false;
    }
    return block.type === 'text'
      ? other.type === 'text' && block.text === other.text
      : other.type === 'context' && block.itemId === other.itemId;
  });
}

export function normalizeComposerInputBlocks(blocks: ComposerBlock[]) {
  const normalizedBlocks = normalizeComposerBlocks(blocks);
  let index = -1;
  for (let candidateIndex = normalizedBlocks.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (normalizedBlocks[candidateIndex].type === 'text') {
      index = candidateIndex;
      break;
    }
  }
  if (index < 0) {
    return normalizedBlocks;
  }
  const block = normalizedBlocks[index];
  if (block.type !== 'text') {
    return normalizedBlocks;
  }
  const normalizedText = normalizeComposerInputText(block.text);
  if (normalizedText === block.text) {
    return normalizedBlocks;
  }
  const next = [...normalizedBlocks];
  if (normalizedText) {
    next[index] = { text: normalizedText, type: 'text' };
  } else {
    next.splice(index, 1);
  }
  return normalizeComposerBlocks(next);
}

export function contextInsertionBlocks(text: string, start: number, itemId: string) {
  const before = text[start - 1] ?? '';
  const after = text[start] ?? '';
  const needsLeadingSpace = before.length > 0 && !isComposerBoundary(before);
  const needsTrailingSpace = after.length === 0 || !isComposerBoundary(after);
  const blocks: ComposerBlock[] = [
    ...(needsLeadingSpace ? [{ text: ' ', type: 'text' as const }] : []),
    { itemId, type: 'context' as const },
    ...(needsTrailingSpace ? [{ text: ' ', type: 'text' as const }] : [])
  ];
  return {
    blocks,
    logicalLength: composerBlocksLogicalLength(blocks)
  };
}

export function removeComposerMentionRange(blocks: ComposerBlock[], start: number, end: number) {
  const next = replaceComposerTextRange(blocks, start, end, []);
  return normalizeComposerBlocks(next).map((block) =>
    block.type === 'text'
      ? { text: block.text.replace(/[ \t]{2,}/g, ' '), type: 'text' as const }
      : block
  );
}

export function replaceComposerTextRange(
  blocks: ComposerBlock[],
  start: number,
  end: number,
  replacement: ComposerBlock[]
) {
  const next: ComposerBlock[] = [];
  let offset = 0;
  let inserted = false;

  const insertReplacement = () => {
    if (!inserted) {
      next.push(...replacement);
      inserted = true;
    }
  };

  for (const block of blocks) {
    if (block.type === 'context') {
      const blockStart = offset;
      const blockEnd = offset + 1;
      if (blockEnd <= start || blockStart >= end) {
        if (!inserted && start <= blockStart) {
          insertReplacement();
        }
        next.push(block);
        offset = blockEnd;
        continue;
      }
      if (!inserted) {
        insertReplacement();
      }
      offset = blockEnd;
      continue;
    }

    const blockStart = offset;
    const blockEnd = offset + block.text.length;
    if (blockEnd <= start || blockStart >= end) {
      if (!inserted && start <= blockStart) {
        insertReplacement();
      }
      next.push(block);
      offset = blockEnd;
      continue;
    }

    const before = block.text.slice(0, Math.max(0, start - blockStart));
    const after = block.text.slice(Math.max(0, end - blockStart));
    if (before) {
      next.push({ text: before, type: 'text' });
    }
    insertReplacement();
    if (after) {
      next.push({ text: after, type: 'text' });
    }
    offset = blockEnd;
  }

  if (!inserted) {
    insertReplacement();
  }

  return normalizeComposerBlocks(next);
}

export function findAdjacentComposerContextBlock(
  blocks: ComposerBlock[],
  offset: number,
  direction: 'backward' | 'forward'
) {
  const logicalText = composerBlocksToLogicalText(blocks);
  let position = 0;
  let target: { itemId: string; start: number } | null = null;

  for (const block of blocks) {
    const length = block.type === 'text' ? block.text.length : 1;
    const start = position;
    const end = position + length;
    if (block.type === 'context') {
      if (
        direction === 'backward' &&
        end <= offset &&
        isComposerWhitespace(logicalText.slice(end, offset))
      ) {
        target = { itemId: block.itemId, start };
      }
      if (
        direction === 'forward' &&
        start >= offset &&
        isComposerWhitespace(logicalText.slice(offset, start))
      ) {
        return { itemId: block.itemId, start };
      }
    }
    position = end;
  }

  return target;
}

export function removeFirstComposerContextBlock(blocks: ComposerBlock[], itemId: string) {
  let removed = false;
  const next = blocks.filter((block) => {
    if (block.type !== 'context' || block.itemId !== itemId || removed) {
      return true;
    }
    removed = true;
    return false;
  });
  const normalized = normalizeComposerBlocks(next).map((block) =>
    block.type === 'text'
      ? { text: block.text.replace(/[ \t]{2,}/g, ' '), type: 'text' as const }
      : block
  );
  if (normalized.every((block) => block.type === 'text' && !block.text.trim())) {
    return [];
  }
  return normalizeComposerBlocks(normalized);
}

export function isComposerBoundary(text: string) {
  return /\s/.test(text) || text === COMPOSER_CONTEXT_CHAR;
}

export function isComposerWhitespace(text: string) {
  return /^[\s\u00a0]*$/.test(text);
}

export function syncComposerContextBlocks(blocks: ComposerBlock[], items: AssistantContextItem[]) {
  void items;
  return normalizeComposerBlocks(blocks.filter((block) => block.type === 'text'));
}

export function stripDanglingMentionBeforeContext(blocks: ComposerBlock[]) {
  const next: ComposerBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'context') {
      const previous = next[next.length - 1];
      if (previous?.type === 'text') {
        const cleaned = previous.text.replace(/(^|[\s\u00a0\uFFFC])@+[^\s\u00a0\uFFFC]*\s*$/u, '$1');
        if (cleaned) {
          previous.text = cleaned;
        } else {
          next.pop();
        }
      }
    }
    next.push(block);
  }
  return normalizeComposerBlocks(next);
}
