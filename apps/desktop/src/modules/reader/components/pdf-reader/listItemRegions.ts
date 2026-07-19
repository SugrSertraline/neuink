export type ListItemRegion = {
  bbox: [number, number, number, number];
  page_idx?: number;
  text: string;
};

export function parseListItemRegions(value: string | undefined): ListItemRegion[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ListItemRegion => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as { bbox?: unknown; page_idx?: unknown; text?: unknown };
      return Array.isArray(candidate.bbox)
        && candidate.bbox.length === 4
        && candidate.bbox.every((part) => typeof part === 'number' && Number.isFinite(part))
        && (candidate.page_idx === undefined || (typeof candidate.page_idx === 'number' && Number.isInteger(candidate.page_idx) && candidate.page_idx >= 0))
        && typeof candidate.text === 'string';
    });
  } catch {
    return [];
  }
}
