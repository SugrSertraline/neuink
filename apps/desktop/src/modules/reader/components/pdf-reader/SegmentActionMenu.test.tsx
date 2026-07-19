/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import { SegmentActionMenu } from './SegmentActionMenu';

const segment: SourceSegment = {
  bbox: [100, 100, 900, 300],
  markdown: 'Source text',
  page_idx: 1,
  segment_type: 'paragraph',
  text: 'Source text',
  uid: 'segment-1'
};

describe('SegmentActionMenu', () => {
  it('separates floating editors from the split segment workspace', () => {
    const onOpenSegmentAnnotation = vi.fn();
    const onOpenSegmentNote = vi.fn();
    const onOpenSegmentWorkspace = vi.fn();
    render(
      <SegmentActionMenu
        canAddSourceLink={false}
        canCopyContent={false}
        canCopySourceLink={false}
        position={{ x: 20, y: 20 }}
        segment={segment}
        sourceBacklinks={[]}
        onClose={vi.fn()}
        onOpenSegmentAnnotation={onOpenSegmentAnnotation}
        onOpenSegmentNote={onOpenSegmentNote}
        onOpenSegmentWorkspace={onOpenSegmentWorkspace}
        onOpenSourceBacklink={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑片段笔记（浮窗）' }));
    fireEvent.click(screen.getByRole('button', { name: '添加批注或高亮（浮窗）' }));
    fireEvent.click(screen.getByRole('button', { name: '在分屏中打开片段记录' }));

    expect(onOpenSegmentNote).toHaveBeenCalledWith(segment);
    expect(onOpenSegmentAnnotation).toHaveBeenCalledWith(segment);
    expect(onOpenSegmentWorkspace).toHaveBeenCalledWith(segment);
  });
});
