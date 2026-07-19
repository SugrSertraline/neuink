// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import { SegmentOutlinePanel } from './SegmentOutlinePanel';

describe('SegmentOutlinePanel', () => {
  it('renders a collapsible hierarchy and jumps to a heading', () => {
    const onJumpToSegment = vi.fn();
    render(
      <SegmentOutlinePanel
        activeSegmentUid="body"
        focusSegmentUid={null}
        open
        segments={[
          segment('chapter', 'Chapter', 1),
          segment('section', 'Section', 2),
          segment('body', 'Body', null, 'paragraph')
        ]}
        onClose={() => undefined}
        onJumpToSegment={onJumpToSegment}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Section' }).getAttribute('aria-current')
    ).toBe('location');
    fireEvent.click(screen.getByRole('button', { name: '收起 Chapter' }));
    expect(screen.queryByRole('button', { name: 'Section' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开 Chapter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Section' }));
    expect(onJumpToSegment).toHaveBeenCalledWith('section');
  });
});

function segment(
  uid: string,
  text: string,
  level: number | null,
  segment_type: SourceSegment['segment_type'] = 'heading'
): SourceSegment {
  return {
    uid,
    segment_type,
    page_idx: level ?? 2,
    bbox: [100, (level ?? 3) * 100, 900, (level ?? 3) * 100 + 80],
    text,
    markdown: null,
    mineru_metadata: level ? { level: String(level) } : {}
  };
}
