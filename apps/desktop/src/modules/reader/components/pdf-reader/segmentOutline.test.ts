import { describe, expect, it } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import {
  buildSegmentOutline,
  headingLevel,
  outlineAncestorUids,
  resolveActiveHeadingUid
} from './segmentOutline';

describe('segmentOutline', () => {
  it('builds a nested tree from MinerU heading levels', () => {
    const chapter = segment('chapter', 'heading', 0, 1);
    const section = segment('section', 'heading', 1, 2);
    const subsection = segment('subsection', 'heading', 2, 3);
    const nextChapter = segment('next', 'heading', 3, 1);
    const outline = buildSegmentOutline([chapter, section, subsection, nextChapter]);

    expect(outline.map((node) => node.segment.uid)).toEqual(['chapter', 'next']);
    expect(outline[0].children[0].segment.uid).toBe('section');
    expect(outline[0].children[0].children[0].segment.uid).toBe('subsection');
    expect(outlineAncestorUids(outline, 'subsection')).toEqual(['chapter', 'section']);
  });

  it('uses markdown heading syntax and a safe fallback when level metadata is absent', () => {
    expect(headingLevel({ ...segment('markdown', 'heading', 0), markdown: '### Title' })).toBe(3);
    expect(headingLevel(segment('fallback', 'heading', 0))).toBe(2);
  });

  it('resolves the nearest preceding heading for the active body segment', () => {
    const chapter = segment('chapter', 'heading', 0, 1);
    const body = segment('body', 'paragraph', 1);
    const next = segment('next', 'heading', 2, 1);

    expect(resolveActiveHeadingUid([chapter, body, next], 'body')).toBe('chapter');
    expect(resolveActiveHeadingUid([chapter, body, next], 'next')).toBe('next');
  });
});

function segment(
  uid: string,
  segment_type: SourceSegment['segment_type'],
  page_idx: number,
  level?: number
): SourceSegment {
  return {
    uid,
    segment_type,
    page_idx,
    bbox: [100, 100, 900, 200],
    text: uid,
    markdown: null,
    mineru_metadata: level ? { level: String(level) } : {}
  };
}
