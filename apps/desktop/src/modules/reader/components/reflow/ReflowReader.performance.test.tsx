/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';
import { DEFAULT_REFLOW_COMPONENT_PREFERENCES } from '@/shared/lib/readerPreferences';
import { ToastContext } from '@/shared/hooks/useToast';
import { TooltipProvider } from '@/components/ui/tooltip';

import { ReflowReader } from './ReflowReader';

describe('ReflowReader virtualization', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const virtualItem = this.hasAttribute('data-reflow-virtual-item');
        return rect(virtualItem ? 150 : 800);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mounts only the viewport window for a long reflow document', async () => {
    const segments = Array.from({ length: 240 }, (_, index) => segment(index));
    const { container } = render(
      <TooltipProvider><ToastContext.Provider value={{ notify: () => 'test', dismiss: vi.fn() }}><div style={{ height: 800 }}>
        <ReflowReader
          activeSegmentUid={null}
          annotationsBySegmentUid={new Map()}
          entryId="entry-1"
          flashSegmentUid={null}
          hiddenSegmentUids={new Set()}
          hoverPreviewEnabled={false}
          hoverPreviewShowOriginal={true}
          hoverPreviewShowTranslation={true}
          hoverPreviewShowNote={true}
          hoverPreviewShowAnnotation={true}
          notesBySegmentUid={new Map()}
          pdfDocument={null}
          reflowBackgroundColor="#fff8ed"
          reflowComponents={DEFAULT_REFLOW_COMPONENT_PREFERENCES}
          reflowFontSize={20}
          reflowTranslationMode="source"
          segments={segments}
          sourceBacklinksBySegmentUid={{}}
          sourceLinkCountBySegmentUid={new Map()}
          translationBySegmentUid={new Map()}
          workspaceRoot={null}
          onActivateSegment={vi.fn()}
          onCopyContent={vi.fn()}
          onCopySourceLink={vi.fn()}
          onHideSegment={vi.fn()}
          onOpenSegmentAnnotation={vi.fn()}
          onOpenSegmentNote={vi.fn()}
          onOpenSourceBacklink={vi.fn()}
          onRequirePdfDocument={vi.fn()}
        />
      </div></ToastContext.Provider></TooltipProvider>
    );

    await waitFor(() => {
      expect(container.querySelectorAll('[data-reflow-virtual-item]').length).toBeGreaterThan(0);
    });

    expect(
      container
        .querySelector('[data-reflow-total-groups]')
        ?.getAttribute('data-reflow-total-groups')
    ).toBe('240');
    expect(container.querySelectorAll('[data-reflow-virtual-item]').length).toBeLessThan(40);
    expect(
      (container.querySelector('[data-reflow-font-size]') as HTMLElement | null)?.style.fontSize
    ).toBe('20px');
    expect(
      (container.querySelector('[data-reflow-background-color]') as HTMLElement | null)?.style
        .backgroundColor
    ).toBe('rgb(255, 248, 237)');
  });
});

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  disconnect() {}

  observe(target: Element) {
    const element = target as HTMLElement;
    const height = element.hasAttribute('data-reflow-virtual-item') ? 150 : 800;
    const size = { blockSize: height, inlineSize: 900 };
    this.callback(
      [{
        borderBoxSize: [size],
        contentBoxSize: [size],
        contentRect: rect(height),
        devicePixelContentBoxSize: [size],
        target
      }],
      this
    );
  }

  unobserve() {}
}

function rect(height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: 900,
    top: 0,
    width: 900,
    x: 0,
    y: 0,
    toJSON: () => ({})
  };
}

function segment(index: number): SourceSegment {
  return {
    bbox: null,
    markdown: null,
    page_idx: Math.floor(index / 4),
    segment_type: 'paragraph',
    text: `Paragraph ${index} ${'content '.repeat(24)}`,
    uid: `segment-${index}`
  };
}
