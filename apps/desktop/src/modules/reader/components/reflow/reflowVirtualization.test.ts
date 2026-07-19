import { describe, expect, it } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import type { ReflowSegmentGroup } from './buildReflowBlocks';
import {
  buildReflowGroupIndex,
  estimateReflowGroupSize
} from './reflowVirtualization';

describe('reflow virtualization helpers', () => {
  it('maps every segment in a visual group to the same virtual row', () => {
    const body = segment('body', 'figure', 'images/figure.png');
    const caption = segment('caption', 'paragraph', 'Figure caption');
    const groups: ReflowSegmentGroup[] = [{
      assetPath: 'images/figure.png',
      body,
      captions: [caption],
      footnotes: [],
      id: 'visual:body',
      kind: 'visual',
      segments: [body, caption]
    }];

    const index = buildReflowGroupIndex(groups);

    expect(index.get('body')).toBe(0);
    expect(index.get('caption')).toBe(0);
  });

  it('reserves more initial space for bilingual and visual content', () => {
    const body = segment('paragraph', 'paragraph', 'A '.repeat(500));
    const textGroup: ReflowSegmentGroup = {
      body,
      captions: [],
      footnotes: [],
      id: 'text:paragraph',
      kind: 'text',
      segments: [body]
    };
    const visualGroup: ReflowSegmentGroup = {
      assetPath: 'images/figure.png',
      body: segment('figure', 'figure', ''),
      captions: [],
      footnotes: [],
      id: 'visual:figure',
      kind: 'visual',
      segments: []
    };

    expect(estimateReflowGroupSize(textGroup, 'bilingual')).toBeGreaterThan(
      estimateReflowGroupSize(textGroup, 'source')
    );
    expect(estimateReflowGroupSize(visualGroup, 'source')).toBe(520);
  });
});

function segment(
  uid: string,
  segmentType: SourceSegment['segment_type'],
  text: string
): SourceSegment {
  return {
    bbox: null,
    markdown: null,
    page_idx: 0,
    segment_type: segmentType,
    text,
    uid
  };
}
