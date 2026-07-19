/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { SegmentSourceContextPreview } from './SegmentSourceContextPreview';

beforeEach(() => window.localStorage.clear());

describe('SegmentSourceContextPreview', () => {
  it('opens the source in record views and highlights selected text in full context', () => {
    render(
      <SegmentSourceContextPreview
        defaultExpanded
        highlightSelections={[{
          color: 'yellow',
          page_idx: 0,
          rects: [[100, 100, 300, 130]],
          text: 'important result'
        }]}
        segment={{
          bbox: [80, 80, 900, 260],
          markdown: 'The complete segment contains an important result for readers.',
          page_idx: 0,
          segment_type: 'paragraph',
          text: 'The complete segment contains an important result for readers.',
          uid: 'segment-1'
        }}
        sourceEntryId="entry-1"
        workspaceRoot={null}
      />
    );

    expect(screen.getByText('暂无可用原图。当前片段仍可查看解析后的原文内容。')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: '切换解析文本和 PDF 原文' }));

    const highlight = screen.getByText('important result');
    expect(highlight.tagName).toBe('MARK');
    expect(highlight.className).toContain('bg-amber-200');
    expect(screen.getByText(/The complete segment contains an/)).toBeTruthy();
  });
});
