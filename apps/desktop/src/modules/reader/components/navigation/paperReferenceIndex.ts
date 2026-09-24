import type { SourceSegment } from '@/shared/types/domain';
import type { ReadingTarget } from './ReadingNavigation';
import { parseListItemRegions } from '../pdf-reader/listItemRegions';

export type PaperReference = ReadingTarget & { label: string; segment: SourceSegment; text: string };
export type ReferenceIndex = Map<string, PaperReference | null>;
export type ReferenceMatch = { start: number; end: number; label: string; targets: PaperReference[] };
const NUMBER = '(?:S?\\d+(?:\\.\\d+)*(?:[a-z])?)';
const LABEL = new RegExp(`(?:\\b(Fig(?:ure)?s?\\.?|Tables?|Eq(?:uation)?s?\\.?)\\s*\\(?(${NUMBER})\\)?|([图表式])\\s*(${NUMBER}))(?![a-z0-9])`, 'gi');
function key(kind: string, number: string) {
  return `${/^fig|图/i.test(kind) ? 'figure' : /^tab|表/i.test(kind) ? 'table' : 'equation'}:${number.toLowerCase()}`;
}
function add(index: ReferenceIndex, id: string, reference: PaperReference) {
  const previous = index.get(id);
  // Conflicting labels are intentionally left as text; never guess a target.
  if (previous === null || (previous && (previous.segmentUid !== reference.segmentUid || (id.startsWith('citation:')
    && (previous.text !== reference.text || previous.pageIdx !== reference.pageIdx || String(previous.rect) !== String(reference.rect)))))) index.set(id, null);
  else index.set(id, reference);
}

function bibliographyRows(text: string) {
  const bibliography = text.replace(/(^|\n)(\s*(?:[-*]\s*)?)(?:\*\*|__)?(?:\\?\[\s*(\d+)\s*\\?\]|［\s*(\d+)\s*］)(?:\*\*|__)?(?=\s)/g, '$1$2[$3$4]');
  return [...bibliography.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(?:\[(\d+)\]|(\d+)[.)])\s+([^\n]*(?:\n(?!\s*(?:[-*]\s*)?(?:\[\d+\]|\d+[.)])\s)[^\n]*)*)/g)]
    .map(row => ({ number: row[1] || row[2], text: row[0].trim() }));
}

export function buildPaperReferenceIndex(segments: SourceSegment[]): ReferenceIndex {
  const result: ReferenceIndex = new Map();
  const visualBodies = new Map<string, SourceSegment>();
  for (const segment of segments) if (segment.visual_group_id && ['figure', 'table', 'math'].includes(segment.segment_type) && segment.block_role !== 'caption') {
    visualBodies.set(segment.visual_group_id, segment);
  }
  let inReferences = false;
  for (const segment of segments) {
    const text = (segment.markdown || segment.text).trim();
    const plain = text.replace(/^#+\s*/, '').replace(/[*_]/g, '').trim();
    const referenceHeading = /^(?:\d+(?:\.\d+)*\.?\s+)?(?:references|bibliography|参考文献)\s*[:：]?$/i.test(plain);
    // Some parsers classify the standalone bibliography heading as a paragraph.
    if (referenceHeading || segment.segment_type === 'heading') inReferences = referenceHeading;
    const body = (segment.visual_group_id && visualBodies.get(segment.visual_group_id)) || segment;
    const reference = (label: string, content = text): PaperReference => ({ label, text: content, segment: body,
      segmentUid: body.uid, pageIdx: body.page_idx, rect: body.bbox ?? undefined });
    const label = [...plain.matchAll(new RegExp(LABEL.source, 'gi'))][0];
    if (label && label.index === 0 && (['figure', 'table', 'math'].includes(segment.segment_type) || /caption/.test(segment.block_role ?? ''))) {
      add(result, key(label[1] || label[3], label[2] || label[4]), reference(label[0]));
    }
    if (segment.segment_type === 'math') {
      const tag = /\\tag\{([^}]+)\}|\((\d+(?:\.\d+)*)\)\s*\$*\s*$/.exec(text);
      if (tag) add(result, `equation:${tag[1] || tag[2]}`, reference(`公式 ${tag[1] || tag[2]}`));
    }
    if (inReferences || /reference|bibliography/i.test(`${segment.sub_type ?? ''} ${segment.raw_type ?? ''}`)) {
      // Item regions may be returned in a different order in a two-column list.
      // Bind text and geometry by the printed number, never by their array index.
      const located: ReferenceIndex = new Map();
      for (const item of parseListItemRegions(segment.mineru_metadata?.list_item_regions)) {
        if (item.bbox[2] <= item.bbox[0] || item.bbox[3] <= item.bbox[1]) continue;
        for (const row of bibliographyRows(item.text)) {
          const entry = { ...segment, bbox: item.bbox, page_idx: item.page_idx ?? segment.page_idx, text: row.text, markdown: row.text };
          add(located, `citation:${row.number}`, { ...reference(`[${row.number}]`, row.text), segment: entry,
            segmentUid: segment.uid, pageIdx: entry.page_idx, rect: item.bbox });
        }
      }
      for (const row of bibliographyRows(text)) {
        const id = `citation:${row.number}`;
        if (!located.has(id)) add(result, id, reference(`[${row.number}]`, row.text));
      }
      for (const [id, entry] of located) {
        if (entry) add(result, id, entry); else result.set(id, null);
      }
    }
  }
  return result;
}

export function matchPaperReferences(text: string, index: ReferenceIndex): ReferenceMatch[] {
  const matches: ReferenceMatch[] = [];
  for (const match of text.matchAll(new RegExp(LABEL.source, 'gi'))) {
    const target = index.get(key(match[1] || match[3], match[2] || match[4]));
    if (target) matches.push({ start: match.index!, end: match.index! + match[0].length, label: match[0], targets: [target] });
  }
  for (const match of text.matchAll(/[\[［]\s*(\d+(?:\s*[,;–—-]\s*\d+)*)\s*[\]］]/g)) {
    const numbers: number[] = [];
    for (const part of match[1].split(/[,;]/)) {
      const range = part.trim().split(/[–—-]/).map(Number);
      if (range.length === 2) {
        if (range[1] < range[0] || range[1] - range[0] > 12) { numbers.length = 0; break; }
        for (let n = range[0]; n <= range[1]; n++) numbers.push(n);
      } else numbers.push(range[0]);
    }
    const targets = [...new Set(numbers)].map(n => index.get(`citation:${n}`));
    if (targets.length && targets.every((target): target is PaperReference => Boolean(target))) {
      matches.push({ start: match.index!, end: match.index! + match[0].length, label: match[0], targets });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}
