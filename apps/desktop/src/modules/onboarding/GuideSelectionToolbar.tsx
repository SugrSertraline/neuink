import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useReaderSelectionPriority } from '@/components/ui/hover-interactions';
import { calculateFloatingToolbarLayout } from '@/modules/reader/components/pdf-reader/PdfTextSelectionToolbar';
import { ReadingSelectionToolbarControls } from '@/modules/reader/components/pdf-reader/ReadingSelectionToolbarControls';
import type { SpotlightRect } from './guideGeometry';

type Rect = Pick<SpotlightRect, 'x' | 'y' | 'width' | 'height'>;

/** Shares the real toolbar's controls, but not its selection, requests, clipboard or saving state. */
export function GuideSelectionToolbar({ text, selection, surface, viewport }: {
  text: string; selection: Rect; surface: Rect; viewport: RefObject<HTMLDivElement | null>;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ReturnType<typeof calculateFloatingToolbarLayout> | null>(null);
  // The visual selection must also suppress the reader's hover cards until this lesson ends.
  useReaderSelectionPriority(true);
  const width = Math.min(368, Math.max(0, surface.width - 16));
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const element = toolbar.current, root = viewport.current;
      if (!element || !root) return;
      const rootBounds = root.getBoundingClientRect();
      const scale = rootBounds.height / (root.clientHeight || rootBounds.height || 1);
      const next = calculateFloatingToolbarLayout({
        anchor:{ left:selection.x, right:selection.x + selection.width, top:selection.y, bottom:selection.y + selection.height },
        contentWidth:width,
        contentHeight:element.scrollHeight || element.getBoundingClientRect().height / scale,
        viewport:{ left:surface.x, top:surface.y, width:surface.width, height:surface.height }
      });
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (toolbar.current) resize?.observe(toolbar.current);
    measure();
    return () => { cancelAnimationFrame(frame); resize?.disconnect(); };
  }, [selection, surface, viewport, width]);

  return <div ref={toolbar} data-guide-selection-toolbar data-material="reader-popover"
    role="region" aria-label="选区操作演示（不执行操作）"
    className="guide-demo-selection-toolbar pointer-events-none absolute z-[2] overflow-hidden rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
    data-placement={layout?.placement}
    style={{ width, left:layout?.left, top:layout?.top, maxHeight:layout?.maxHeight, visibility:layout ? 'visible' : 'hidden' }}>
    <ReadingSelectionToolbarControls text={text} demonstration />
  </div>;
}
