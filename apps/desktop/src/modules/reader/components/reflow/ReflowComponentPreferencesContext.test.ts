import { describe, expect, it } from 'vitest';

import { DEFAULT_REFLOW_COMPONENT_PREFERENCES } from '@/shared/lib/readerPreferences';
import type { SourceSegment } from '@/shared/types/domain';

import type { ReflowSegmentGroup } from './buildReflowBlocks';
import {
  isReflowGroupVisible,
  reflowComponentKeyForGroup,
  reflowGroupEstimateScale,
  reflowGroupTextScale,
  reflowGroupVisualSize
} from './ReflowComponentPreferencesContext';

describe('reflow component preferences', () => {
  it('classifies parsed charts separately from figures', () => {
    expect(reflowComponentKeyForGroup(group(segment('figure', { raw_type: 'chart' })))).toBe('chart');
    expect(reflowComponentKeyForGroup(group(segment('figure', { raw_type: 'image' })))).toBe('figure');
  });

  it('filters disabled components and Mermaid-only segments', () => {
    const chart = group(segment('figure', { raw_type: 'chart' }));
    const mermaid = group(segment('code', { markdown: '```mermaid\ngraph TD\nA-->B\n```' }));
    const preferences = {
      ...DEFAULT_REFLOW_COMPONENT_PREFERENCES,
      chart: { ...DEFAULT_REFLOW_COMPONENT_PREFERENCES.chart, visible: false },
      diagramVisible: false
    };

    expect(isReflowGroupVisible(chart, preferences)).toBe(false);
    expect(isReflowGroupVisible(mermaid, preferences)).toBe(false);
  });

  it('uses independent text and visual size scales for virtualization', () => {
    const heading = group(segment('heading'));
    const chart = group(segment('figure', { raw_type: 'chart' }));
    const preferences = {
      ...DEFAULT_REFLOW_COMPONENT_PREFERENCES,
      heading: { visible: true, size: 'large' as const },
      chart: { visible: true, size: 'compact' as const }
    };

    expect(reflowGroupTextScale(heading, preferences)).toBeGreaterThan(1);
    expect(reflowGroupEstimateScale(chart, preferences)).toBe(0.75);
  });

  it('applies the table component size to image-based table rendering', () => {
    const table = group(segment('table', { raw_type: 'table' }));
    const preferences = {
      ...DEFAULT_REFLOW_COMPONENT_PREFERENCES,
      table: { visible: true, size: 'large' as const },
      figure: { visible: true, size: 'compact' as const }
    };

    expect(reflowComponentKeyForGroup(table)).toBe('table');
    expect(reflowGroupVisualSize(table, preferences)).toBe('large');
    expect(reflowGroupEstimateScale(table, preferences)).toBe(1.5);
  });
});

function segment(
  segmentType: SourceSegment['segment_type'],
  overrides: Partial<SourceSegment> = {}
): SourceSegment {
  return {
    bbox: null,
    markdown: null,
    page_idx: 0,
    segment_type: segmentType,
    text: 'content',
    uid: `${segmentType}-1`,
    ...overrides
  };
}

function group(body: SourceSegment): ReflowSegmentGroup {
  const visual =
    body.segment_type === 'figure' ||
    body.raw_type === 'image' ||
    body.raw_type === 'chart' ||
    body.raw_type === 'table';
  return {
    assetPath: body.asset_path,
    body,
    captions: [],
    footnotes: [],
    id: body.uid,
    kind: visual ? 'visual' : 'text',
    segments: [body]
  };
}
