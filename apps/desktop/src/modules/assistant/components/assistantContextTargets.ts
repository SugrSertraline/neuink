import type { PointerEvent as ReactPointerEvent } from 'react';

import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { AssistantContextItem } from '@/shared/types/assistant';

export type EntryContextTarget = {
  contentId?: string;
  contentKind?: 'entry' | 'note' | 'overview' | 'pdf' | 'reflow';
  contentTitle?: string;
  entry: LibraryEntry;
};

export function scopeLabel(scope: ScopeSnapshot) {
  if (scope.tag_names.length > 0) {
    return `Tag scope: ${scope.tag_names.join(' / ')}`;
  }
  if (scope.entry_titles.length === 1) {
    return `Entry: ${scope.entry_titles[0]}`;
  }
  return `Parsed entries: ${scope.entry_titles.length}`;
}

export function entryContentTargets(entry: LibraryEntry): EntryContextTarget[] {
  const targets: EntryContextTarget[] = [
    {
      contentKind: 'entry',
      contentTitle: 'Overall',
      entry
    }
  ];
  if (entry.pdfFileName) {
    targets.push({
      contentId: 'pdf',
      contentKind: 'pdf',
      contentTitle: 'PDF',
      entry
    });
  }
  for (const content of entry.contents) {
    if (content.kind !== 'note') {
      continue;
    }
    targets.push({
      contentId: content.note_id,
      contentKind: 'note',
      contentTitle: content.title,
      entry
    });
  }
  return targets;
}

export function entryMarkdownTargets(entry: LibraryEntry): EntryContextTarget[] {
  const targets: EntryContextTarget[] = [];
  if (entry.pdfFileName) {
    targets.push({
      contentId: 'pdf',
      contentKind: 'pdf',
      contentTitle: 'PDF',
      entry
    });
  }
  for (const content of entry.contents) {
    if (content.kind !== 'note') {
      continue;
    }
    targets.push({
      contentId: content.note_id,
      contentKind: 'note',
      contentTitle: content.title,
      entry
    });
  }
  return targets;
}

export function entryOriginalTarget(entry: LibraryEntry): EntryContextTarget {
  return {
    contentKind: 'entry',
    contentTitle: 'Overall',
    entry
  };
}

export function radialTargetsForEntry(entry: LibraryEntry) {
  return entryContentTargets(entry).slice(0, 6);
}

export function entryContextKey(target: EntryContextTarget) {
  const kind = target.contentKind ?? 'entry';
  return `entry:${target.entry.id}:${kind}:${target.contentId ?? kind}`;
}

export function targetContextItemId(target: EntryContextTarget) {
  const kind = target.contentKind ?? 'entry';
  return kind === 'entry'
    ? `entry:${target.entry.id}`
    : `entry:${target.entry.id}:${kind}:${target.contentId ?? kind}`;
}

export function entryTargetLabel(target: EntryContextTarget) {
  if (!target.contentKind || target.contentKind === 'entry') {
    return target.contentTitle ?? 'Overall';
  }
  return target.contentTitle ?? entryContentKindLabel(target.contentKind);
}

export function entryTargetMenuLabel(target: EntryContextTarget) {
  const kind = target.contentKind ?? 'entry';
  if (kind === 'entry') {
    return 'Overall';
  }
  if (kind === 'pdf') {
    return 'PDF';
  }
  if (kind === 'note') {
    return target.contentTitle ?? 'Markdown';
  }
  return entryTargetLabel(target);
}

export function entryContentKindLabel(kind: NonNullable<EntryContextTarget['contentKind']>) {
  if (kind === 'pdf') {
    return 'PDF';
  }
  if (kind === 'note') {
    return 'Markdown';
  }
  if (kind === 'reflow') {
    return 'Reflow';
  }
  if (kind === 'overview') {
    return 'Overview';
  }
  return 'Entry';
}

export function entryContextKindLabel(item: AssistantContextItem) {
  if (item.kind !== 'entry') {
    return 'Excerpt';
  }
  if (!item.contentKind || item.contentKind === 'entry') {
    return 'Overall';
  }
  if (item.contentKind === 'pdf') {
    return 'PDF';
  }
  if (item.contentKind === 'note') {
    return 'Markdown';
  }
  if (item.contentKind === 'reflow') {
    return 'Reflow';
  }
  return 'Overview';
}

export function startRadialPicker(
  event: ReactPointerEvent<HTMLElement>,
  item: AssistantContextItem,
  setRadialPicker: (value: {
    activeIndex: number | null;
    item: AssistantContextItem;
    x: number;
    y: number;
  }) => void
) {
  if (item.kind !== 'entry' || event.button !== 0) {
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  setRadialPicker({
    activeIndex: null,
    item,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  });
}

export function radialOptionPosition(x: number, y: number, index: number, total: number) {
  const middle = (Math.max(total, 1) - 1) / 2;
  const offset = (index - middle) * 38;
  const curve = Math.abs(index - middle) * 10;
  return {
    x: x + 112 + curve,
    y: y + offset
  };
}

export function radialTargetIndex(pointerX: number, pointerY: number, centerX: number, centerY: number, total: number) {
  if (total === 0 || pointerX < centerX + 34) {
    return null;
  }
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < total; index += 1) {
    const position = radialOptionPosition(centerX, centerY, index, total);
    const dx = pointerX - position.x;
    const dy = pointerY - position.y;
    const insideCapsule = Math.abs(dx) <= 82 && Math.abs(dy) <= 22;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (insideCapsule) {
      return index;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestDistance <= 58 ? bestIndex : null;
}

export function contextItemLabel(item: AssistantContextItem) {
  if (item.kind === 'entry') {
    return item.contentKind && item.contentKind !== 'entry'
      ? `${item.entryTitle} [${item.contentTitle ?? entryContextKindLabel(item)}]`
      : `${item.entryTitle} [${item.contentTitle ?? 'Overall'}]`;
  }
  return `p.${item.pageIdx + 1} · ${compactText(item.text || item.segmentUid)}`;
}

export function contextItemDisplayTitle(item: AssistantContextItem) {
  if (item.kind !== 'entry') {
    return contextItemLabel(item);
  }
  return item.contentKind === 'note' ? item.contentTitle ?? item.entryTitle : item.entryTitle;
}

export function contextItemChipTitle(item: AssistantContextItem) {
  if (item.kind !== 'entry') {
    return compactText(item.text || item.segmentUid, 24);
  }
  if (item.contentKind === 'note') {
    return compactText(item.contentTitle ?? item.entryTitle, 24);
  }
  return compactText(item.entryTitle, 24);
}

export function compactText(text: string, maxLength = 72) {
  const compacted = text.replace(/\s+/g, ' ').trim();
  return compacted.length > maxLength ? `${compacted.slice(0, Math.max(0, maxLength - 1))}…` : compacted;
}



