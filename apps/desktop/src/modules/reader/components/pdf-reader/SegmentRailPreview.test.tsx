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
        bookmarkSegmentUids={new Set()}
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

  it('labels bookmarks separately and keeps mixed marked positions independently reachable', () => {
    const onJumpToSegment = vi.fn();
    const saved = segment('saved', 'paragraph', 'A saved location');
    const annotated = segment('annotated', 'paragraph', 'An annotated location');
    render(<HoverCard open><SegmentRailPreview segment={saved} segments={[saved, annotated]}
      bookmarkSegmentUids={new Set(['saved'])} noteSegmentUids={new Set(['saved'])} annotationSegmentUids={new Set(['annotated'])}
      onJumpToSegment={onJumpToSegment} /></HoverCard>);
    expect(screen.getAllByText('收藏 1 处')).toHaveLength(2);
    expect(screen.getAllByText('笔记 1 处')).toHaveLength(2);
    expect(screen.getAllByText('批注 1 处')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /批注 1 处 An annotated location/ }));
    expect(onJumpToSegment).toHaveBeenCalledExactlyOnceWith('annotated');
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
