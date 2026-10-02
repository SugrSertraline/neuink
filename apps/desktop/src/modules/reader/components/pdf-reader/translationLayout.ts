import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { PageSegments, SegmentRegionItem } from './types';

type Box = SegmentRegionItem['bbox'];
export type TranslationPlacement = { bbox: Box; sourceBbox: Box };
const overlapX = (a: Box, b: Box) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]);

/** Redistribute only consecutive, fully translated body paragraphs in one column.
 * Coordinates stay in source-page units; figures, captions, tables, headings,
 * missing translations and ambiguous overlapping regions are hard boundaries.
 */
export function layoutTranslatedParagraphs(page: PageSegments, translations: Map<string, TranslatedSegment>) {
  const result = new Map<string, TranslationPlacement>();
  const eligible = (r: SegmentRegionItem) => r.segment.segment_type === 'paragraph' && !r.isContinuation &&
    r.segment.block_role !== 'caption' && !r.segment.asset_path && r.bbox.every(Number.isFinite) && r.bbox[2] > r.bbox[0] && r.bbox[3] > r.bbox[1] &&
    Boolean(translations.get(r.sourceSegment.uid)?.translated_text?.trim());
  const remaining = new Set(page.regions.filter(eligible));
  for (const first of [...remaining].sort((a, b) => a.bbox[1] - b.bbox[1])) {
    if (!remaining.delete(first)) continue;
    const run = [first];
    let last = first;
    while (true) {
      const candidate = [...remaining].filter(r =>
        r.bbox[1] >= last.bbox[3] && r.bbox[1] - last.bbox[3] <= 28 &&
        Math.abs(r.bbox[0] - first.bbox[0]) <= 8 && Math.abs(r.bbox[2] - first.bbox[2]) <= 8
      ).sort((a, b) => a.bbox[1] - b.bbox[1])[0];
      if (!candidate) break;
      const corridor: Box = [Math.min(first.bbox[0], candidate.bbox[0]), last.bbox[1], Math.max(first.bbox[2], candidate.bbox[2]), candidate.bbox[3]];
      if (page.regions.some(r => !run.includes(r) && r !== candidate && overlapX(r.bbox, corridor) && r.bbox[3] > corridor[1] && r.bbox[1] < corridor[3])) break;
      remaining.delete(candidate); run.push(candidate); last = candidate;
    }
    if (run.length < 2) continue;
    const top = first.bbox[1], bottom = last.bbox[3], gap = 4;
    const available = bottom - top - gap * (run.length - 1);
    if (available < run.length * 12) continue;
    const weights = run.map(r => {
      const text = translations.get(r.sourceSegment.uid)!.translated_text ?? '';
      const units = [...text].reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : .55), 0);
      return Math.max(1, Math.ceil(units / Math.max(8, (r.bbox[2] - r.bbox[0]) / 23.5)));
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let y = top;
    run.forEach((r, i) => {
      const height = 12 + (available - 12 * run.length) * weights[i] / sum;
      result.set(r.id, { sourceBbox: r.bbox, bbox: [r.bbox[0], y, r.bbox[2], i === run.length - 1 ? bottom : y + height] });
      y += height + gap;
    });
  }
  return result;
}
