// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HoverCard } from '@/components/ui/hover-card';

import { SegmentRailPreview } from './SegmentRailPreview';

describe('SegmentRailPreview', () => {
  afterEach(cleanup);

  it('shows every overlapping segment as a click-to-scroll option', () => {
    const onJumpToSegment = vi.fn();
    render(
      <HoverCard open>
        <SegmentRailPreview
        annotationSegmentUids={new Set()}
        noteSegmentUids={new Set(['heading-1'])}
        segment={segment('heading-1', 'heading', 'Overview')}
        segments={[
          segment('heading-1', 'heading', 'Overview'),
          segment('paragraph-1', 'paragraph', 'Detailed explanation'),
        ]}
          onJumpToSegment={onJumpToSegment}
        />
      </HoverCard>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Overview/i }));
    fireEvent.click(screen.getByRole('button', { name: /Detailed explanation/i }));

    expect(onJumpToSegment).toHaveBeenNthCalledWith(1, 'heading-1');
    expect(onJumpToSegment).toHaveBeenNthCalledWith(2, 'paragraph-1');
  });
});

function segment(uid: string, segment_type: 'heading' | 'paragraph', text: string) {
  return {
    bbox: [0, 0, 100, 40] as [number, number, number, number],
    markdown: null,
    mineru_metadata: {},
    page_idx: 0,
    segment_type,
    text,
    uid,
  };
}
