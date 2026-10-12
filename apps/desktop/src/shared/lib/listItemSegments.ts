import type { SourceSegment } from '@/shared/types/domain';

export type ListItemRegion = {
  bbox: [number, number, number, number];
  page_idx?: number;
  text: string;
};

export function parseListItemRegions(value: string | undefined): ListItemRegion[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ListItemRegion => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<ListItemRegion>;
      return Array.isArray(candidate.bbox) && candidate.bbox.length === 4
        && candidate.bbox.every(part => typeof part === 'number' && Number.isFinite(part))
        && (candidate.page_idx === undefined || (Number.isInteger(candidate.page_idx) && candidate.page_idx >= 0 && candidate.page_idx <= 4294967295))
        && typeof candidate.text === 'string';
    });
  } catch { return []; }
}

export function listItemAddress(uid: string) {
  const match = /^(.*):list-item:(0|[1-9]\d*)$/.exec(uid);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  return { parentUid: match[1], index: Number(match[2]) };
}

/** Keep nested lists and wrapped lines with their top-level item. Also used by Rust source resolution. */
export function listItemTexts(text: string): string[] {
  const lines = text.trim().split(/\r?\n/);
  const marker = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
  const indents = lines.flatMap(line => { const match = marker.exec(line); return match ? [match[1].length] : []; });
  if (!indents.length) return lines.map(line => line.trim()).filter(Boolean);
  const indent = Math.min(...indents);
  const items: string[] = [];
  for (const line of lines) {
    const match = marker.exec(line);
    if (match && match[1].length === indent) items.push(match[2]);
    else if (items.length) items[items.length - 1] += `\n${line}`;
  }
  return items.map(item => item.trim());
}

/** Virtual children preserve the saved parent; every action and source lookup uses the same identity. */
export function listItemSegments(segment: SourceSegment): SourceSegment[] {
  if (segment.segment_type !== 'list' || listItemAddress(segment.uid)) return [];
  const regions = parseListItemRegions(segment.mineru_metadata?.list_item_regions);
  const items: Array<{ text: string; bbox?: ListItemRegion['bbox']; page_idx?: number }> = regions.length
    ? regions : listItemTexts(segment.markdown ?? segment.text).map(text => ({ text }));
  return items.map((item, index) => ({
    ...segment,
    uid: `${segment.uid}:list-item:${index}`,
    continuation_group_id: null,
    visual_group_id: null,
    bbox: item.bbox ?? null,
    page_idx: item.page_idx ?? segment.page_idx,
    text: item.text,
    markdown: item.text,
    mineru_metadata: {
      ...segment.mineru_metadata,
      list_parent_uid: segment.uid,
      list_item_index: String(index),
      list_item_regions: JSON.stringify(item.bbox ? [item] : []),
    },
  }));
}

export function findSourceSegment(segments: SourceSegment[], uid: string): SourceSegment | undefined {
  const direct = segments.find(segment => segment.uid === uid || segment.continuation_group_id === uid);
  if (direct) return direct;
  const address = listItemAddress(uid);
  const parent = address && segments.find(segment => segment.uid === address.parentUid);
  return parent ? listItemSegments(parent)[address.index] : undefined;
}

export function withListItemSegments(segments: SourceSegment[]) {
  return segments.flatMap(segment => [segment, ...listItemSegments(segment)]);
}

export function requiresListItemChoice(segment: SourceSegment) {
  return listItemSegments(segment).length > 1;
}
