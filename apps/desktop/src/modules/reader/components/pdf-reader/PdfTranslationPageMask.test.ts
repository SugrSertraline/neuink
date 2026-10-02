import { describe, expect, it } from 'vitest';

import { pdfOriginalContentWindows } from './PdfTranslationPageMask';
import type { PageSegments, SegmentRegionItem } from './types';

function region(type: SegmentRegionItem['segment']['segment_type'], bbox: SegmentRegionItem['bbox']): SegmentRegionItem {
  const segment: SegmentRegionItem['segment'] = {
    uid: type, segment_type: type, bbox: [...bbox], page_idx: 0, text: type, markdown: type,
  };
  return { id: type, bbox, segment, sourceSegment: segment, pageIdx: 0,
    hoverGroupUid: type, isContinuation: false, relationGroupUid: null };
}

describe('translation page original windows', () => {
  it('retains tables, figures, equations and algorithms but masks all other page areas', () => {
    const regions = ['paragraph', 'heading', 'table', 'figure', 'math', 'code', 'page_number']
      .map(type => region(type as SegmentRegionItem['segment']['segment_type'], [100, 200, 400, 500]));
    const page: PageSegments = { pageIdx: 0, regions, segments: regions.map(item => item.segment) };
    expect(pdfOriginalContentWindows(page)).toEqual(Array(4).fill([100, 200, 400, 500]));
  });

  it('keeps windows on the page and ignores invalid visual bounds', () => {
    const regions = [region('figure', [1200, 500, -100, 100]), region('table', [10, 20, NaN, 40]),
      region('math', [10, 20, 10, 40]), region('code', [1100, 100, 1200, 200])];
    expect(pdfOriginalContentWindows({ pageIdx: 0, regions, segments: [] })).toEqual([[0, 100, 1000, 500]]);
  });
});
