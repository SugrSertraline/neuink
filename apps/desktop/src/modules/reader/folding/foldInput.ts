import type { SourceSegment } from '@/shared/types/domain';

export type FoldInput = {
  segmentUid: string;
  pageIndex: number;
  source: string;
  sentences: string[];
};

export type FoldSkipped = { segmentUid: string; reason: 'unsupported' | 'empty' | 'continuation' | 'inline_math' | 'rich_content' | 'too_short' | 'too_long' | 'duplicate' };
export type FoldInputs = { batches: FoldInput[][]; skipped: FoldSkipped[] };

/** A selected passage belongs to the nearest preceding heading up to the next heading. */
export function foldSectionForSegment(segments: readonly SourceSegment[], uid: string | null | undefined): SourceSegment[] {
  const selected = segments.findIndex(segment => segment.uid === uid);
  if (selected < 0) return [];
  let start = selected;
  while (start > 0 && segments[start].segment_type !== 'heading') start--;
  if (segments[start].segment_type === 'heading') start++;
  let end = start;
  while (end < segments.length && segments[end].segment_type !== 'heading') end++;
  return segments.slice(start, end);
}

const MAX_BATCH_CHARS = 7_500;
const MAX_BATCH_SEGMENTS = 8;
export const FOLD_MIN_WORDS = 20;
export const FOLD_MIN_CJK = 40;
const MIN_LENGTH_UNITS = FOLD_MIN_CJK;

/** Two CJK characters count like one word; punctuation and whitespace add no length. */
export function foldLengthUnits(text: string): number {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const cjkCount = (text.match(cjk) ?? []).length;
  const words = text.replace(cjk, ' ').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
  return cjkCount + words.length * 2;
}

/** Preserve the exact source sentences, so a model cannot invent the Brief layer. */
export function sourceSentences(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locale: undefined, options: { granularity: 'sentence' }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter(undefined, { granularity: 'sentence' });
    return Array.from(segmenter.segment(text), ({ segment }) => segment.trim()).filter(Boolean);
  }
  // Without a sentence segmenter, keep the whole passage as a single safe unit.
  return text.trim() ? [text.trim()] : [];
}

/** Only fold individually addressable body paragraphs. Non-text and cross-page groups stay unchanged. */
export function buildFoldInputs(segments: readonly SourceSegment[]): FoldInputs {
  const batches: FoldInput[][] = [];
  const skipped: FoldSkipped[] = [];
  const counts = new Map<string, number>();
  for (const segment of segments) counts.set(segment.uid, (counts.get(segment.uid) ?? 0) + 1);
  let batch: FoldInput[] = [];
  let chars = 0;
  const flush = () => {
    if (batch.length) batches.push(batch);
    batch = [];
    chars = 0;
  };

  for (const segment of segments) {
    if (segment.segment_type === 'heading') flush();
    if ((counts.get(segment.uid) ?? 0) > 1) {
      skipped.push({ segmentUid: segment.uid, reason: 'duplicate' });
      continue;
    }
    if (segment.segment_type !== 'paragraph' || segment.asset_path || (segment.block_role && segment.block_role !== 'body')) {
      skipped.push({ segmentUid: segment.uid, reason: 'unsupported' });
      continue;
    }
    if (segment.continuation_group_id) {
      skipped.push({ segmentUid: segment.uid, reason: 'continuation' });
      continue;
    }
    // Do not hide or rewrite inline equations until their source mapping is supported.
    if (/\$|\\\(|\\\[|<math\b/i.test(segment.markdown ?? segment.text)) {
      skipped.push({ segmentUid: segment.uid, reason: 'inline_math' });
      continue;
    }
    // Plain-text folding cannot preserve inline links, emphasis, code or HTML.
    if (segment.markdown && /[*_`<]|\]\(/.test(segment.markdown)) {
      skipped.push({ segmentUid: segment.uid, reason: 'rich_content' });
      continue;
    }
    const source = segment.text.trim();
    if (!source) {
      skipped.push({ segmentUid: segment.uid, reason: 'empty' });
      continue;
    }
    if (source.length > MAX_BATCH_CHARS) {
      skipped.push({ segmentUid: segment.uid, reason: 'too_long' });
      continue;
    }
    if (foldLengthUnits(source) < MIN_LENGTH_UNITS) {
      skipped.push({ segmentUid: segment.uid, reason: 'too_short' });
      continue;
    }
    if (batch.length >= MAX_BATCH_SEGMENTS || chars + source.length > MAX_BATCH_CHARS) flush();
    batch.push({ segmentUid: segment.uid, pageIndex: segment.page_idx, source, sentences: sourceSentences(source) });
    chars += source.length;
  }
  flush();
  return { batches, skipped };
}
