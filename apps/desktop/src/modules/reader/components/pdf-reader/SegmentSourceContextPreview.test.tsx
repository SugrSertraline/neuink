/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SegmentSourceContextPreview } from './SegmentSourceContextPreview';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('SegmentSourceContextPreview', () => {
  it('renders the segment-note original preview without a second disclosure or image dialog trigger', () => {
    const { container } = render(
      <SegmentSourceContextPreview
        embeddedOriginal
        segment={{
          bbox: null,
          markdown: 'Source text',
          page_idx: 0,
          segment_type: 'paragraph',
          text: 'Source text',
          uid: 'segment-embedded'
        }}
        sourceEntryId="entry-1"
        workspaceRoot={null}
      />
    );

    expect(container.querySelector('[title="展开原文"]')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(container.querySelector('[title="单击查看完整 PDF 原文"]')).toBeNull();
  });

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
