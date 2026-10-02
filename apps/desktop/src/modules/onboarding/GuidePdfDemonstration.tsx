import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { findSpotlightTarget } from './useSpotlight';
import { getGuideVisibleBounds, measureGuideSpotlight, type SpotlightRect } from './guideGeometry';
import { GuideSelectionToolbar } from './GuideSelectionToolbar';

export type PdfDemoMode = 'parsed' | 'blocks' | 'hover' | 'selection-translation';
type DemoSpot = { id: string; x: number; y: number; width: number; height: number; label: string; text:string; surface:SpotlightRect };

function visibleSample(element: Element, viewport: HTMLElement) {
  const bounds = getGuideVisibleBounds(element, viewport);
  return Boolean(bounds && bounds.width > 24 && bounds.height > 8);
}

function toSpot(element: HTMLElement, page:HTMLElement, root: HTMLElement, id: string, label: string): DemoSpot | null {
  const bounds = measureGuideSpotlight(element, root, 0);
  const surface = measureGuideSpotlight(page, root, 0);
  return bounds && surface ? { id, x:bounds.x, y:bounds.y, width:bounds.width, height:bounds.height, label,
    text:element.textContent?.trim() ?? '', surface } : null;
}

/** A visual lesson over real PDF geometry. It never changes selection, notes, or translation state. */
export function GuidePdfDemonstration({ mode, viewport, surfaceKey }: {
  mode: PdfDemoMode; viewport: RefObject<HTMLDivElement | null>; surfaceKey?: string | null;
}) {
  const [spot, setSpot] = useState<DemoSpot | null>(null);
  const hoveredRegion = useRef<string | null>(null);
  const revealedSample = useRef(false);

  useLayoutEffect(() => {
    let frame = 0;
    let observer: MutationObserver | null = null;
    let resize: ResizeObserver | null = null;
    let sample: HTMLElement | null = null;
    const measure = () => {
      frame = 0;
      const root = viewport.current;
      const page = root && findSpotlightTarget('[data-guide="pdf-page"]', root, surfaceKey);
      const hitLayer = page?.closest<HTMLElement>('[data-pdf-page-surface]');
      if (!root || !page || !hitLayer) { setSpot(null); return; }
      const regions = [...hitLayer.querySelectorAll<HTMLElement>('[data-segment-uid]')]
        .filter(element => visibleSample(element, root));
      const region = regions.find(element => element.title.includes('段落')) ?? regions[0];
      const allTextSpans = mode === 'selection-translation'
        ? [...page.querySelectorAll<HTMLElement>('.pdf-text-layer span')]
          .filter(element => (element.textContent?.trim().length ?? 0) >= 6)
        : [];
      const textSpan = mode === 'selection-translation'
        ? allTextSpans.find(element => visibleSample(element, root))
        : null;
      // Keep one example anchored for the lesson, rather than moving the outline
      // to whichever paragraph becomes the first visible one after a resize.
      if (!sample?.isConnected) sample = (mode === 'selection-translation' ? textSpan : region) ?? null;
      if (!revealedSample.current && !sample) {
        sample = mode === 'selection-translation' ? allTextSpans[0] ?? null
          : hitLayer.querySelector<HTMLElement>('[data-segment-uid]');
        if (sample) { revealedSample.current = true; sample.scrollIntoView?.({ block:'center', behavior:'auto' }); schedule(); }
      }
      const element = sample;
      const next = element ? toSpot(element, page, root,
        mode === 'selection-translation' ? `text:${element.textContent}` : `segment:${element.dataset.segmentUid}`,
        mode === 'selection-translation' ? '自动演示 · 选中文字' : element.title || '解析内容块') : null;
      setSpot(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);

      // Reuse the reader's own preview, so the example contains the real source and saved records.
      if (mode === 'hover' && element && next && hoveredRegion.current !== element.dataset.segmentUid && typeof PointerEvent !== 'undefined') {
        hoveredRegion.current = element.dataset.segmentUid ?? null;
        const bounds = getGuideVisibleBounds(element, root)!;
        page.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerType:'mouse', buttons:0,
          clientX:bounds.left + bounds.width / 2, clientY:bounds.top + bounds.height / 2 }));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const attach = () => {
      observer?.disconnect(); resize?.disconnect();
      const root = viewport.current;
      const page = root && findSpotlightTarget('[data-guide="pdf-page"]', root, surfaceKey);
      const hitLayer = page?.closest<HTMLElement>('[data-pdf-page-surface]');
      if (hitLayer) {
        observer = new MutationObserver(schedule);
        observer.observe(hitLayer, { childList:true, subtree:true });
        resize = new ResizeObserver(schedule);
        resize.observe(hitLayer);
      }
      schedule();
    };
    attach();
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect(); resize?.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [mode, viewport, surfaceKey]);

  if (!spot) return null;
  const selection = mode === 'selection-translation';
  return <div className="pointer-events-none absolute inset-0" data-guide-pdf-demo={mode}>
    <div aria-hidden="true" key={spot.id} className={selection ? 'guide-demo-selection absolute z-[1] rounded-[2px]' : 'guide-demo-block absolute z-[1] rounded-[2px] border-2 border-primary bg-primary/10'}
      style={{ left:spot.x, top:spot.y, width:spot.width, height:spot.height }} />
    <div aria-hidden="true" className="absolute z-[2] max-w-64 truncate rounded border border-primary/40 bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-sm"
      style={{ left:spot.x, top:Math.max(8, spot.y - 30) }}>
      {selection ? '自动演示 · 选中文字' : mode === 'hover' ? `悬停预览 · ${spot.label}` : `解析块 · ${spot.label}`}
    </div>
    {selection ? <GuideSelectionToolbar key={`toolbar:${spot.id}`} text={spot.text} selection={spot} surface={spot.surface} viewport={viewport} /> : null}
  </div>;
}
