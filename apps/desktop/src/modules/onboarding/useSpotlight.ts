import { useLayoutEffect, useState, type RefObject } from 'react';
import { getGuideVisibleBounds, measureGuideSpotlight, type SpotlightRect } from './guideGeometry';
export type { SpotlightRect } from './guideGeometry';

/** Visual highlighting and interaction permissions must choose the same visible instance. */
export function findSpotlightTarget(selector: string, viewport: HTMLElement | null, surfaceKey?: string | null) {
  if (!viewport || surfaceKey === null) return undefined;
  return [...document.querySelectorAll<HTMLElement>(selector)].find(element => {
    if (element.closest('[data-guide-overlay]')) return false;
    if (surfaceKey !== undefined) {
      const surface = element.closest<HTMLElement>('[data-workspace-surface-key]');
      if (surface?.dataset.workspaceSurfaceKey !== surfaceKey || surface.dataset.workspaceSurfaceActive !== 'true') return false;
    }
    const canvas = element.dataset.guide === 'pdf-page' ? element.querySelector('canvas') : null;
    if (canvas && (canvas.dataset.pdfRendered !== 'true' || !canvas.width || !canvas.height)) return false;
    return Boolean(getGuideVisibleBounds(element, viewport));
  });
}

/** Read viewport geometry only while the guide is visible. No idle RAF loop. */
export function useSpotlight(selector: string, viewport: RefObject<HTMLDivElement | null>, enabled = true, stepKey = selector, surfaceKey?: string | null) {
  const [snapshot, setSnapshot] = useState<{ key:string; rect:SpotlightRect | null } | null>(null);
  useLayoutEffect(() => {
    setSnapshot(null);
    if (!enabled) return;
    let frame = 0;
    let candidate: SpotlightRect | null = null;
    let targetInstance: Element | null = null;
    let published = false;
    const observed = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const root = viewport.current;
      if (!root) return;
      const target = findSpotlightTarget(selector, root, surfaceKey);
      if (targetInstance !== (target ?? null)) {
        targetInstance = target ?? null; candidate = null; published = false;
        for (const element of observed) resize.unobserve(element);
        observed.clear();
        // Image decoding can move a cue without resizing the cue itself.
        for (let element: Element | null = target ?? null; element; element = element.parentElement) observed.add(element);
        observed.add(root);
        for (const element of observed) resize.observe(element);
      }
      const next = target ? measureGuideSpotlight(target, root) : null;
      // Stabilize only a new target. Live scrolling must not unmount the lesson,
      // recreate its demo, or briefly replace the panel with a loading notice.
      if (!published && JSON.stringify(candidate) !== JSON.stringify(next)) {
        candidate = next;
        setSnapshot(null);
        if (next) schedule();
        return;
      }
      published = Boolean(next);
      setSnapshot(previous => previous?.key === stepKey && JSON.stringify(previous.rect) === JSON.stringify(next)
        ? previous : { key:stepKey, rect:next });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element) || !record.target.closest('[data-guide-overlay]'))) schedule();
    });
    mutations.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden', 'aria-hidden', 'data-aria-hidden', 'style', 'class', 'data-state', 'data-pdf-rendered', 'width', 'height', 'src'] });
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('load', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); document.removeEventListener('scroll', schedule, true); document.removeEventListener('load', schedule, true); window.removeEventListener('resize', schedule); };
  }, [selector, viewport, enabled, stepKey, surfaceKey]);
  return enabled && snapshot?.key === stepKey ? snapshot.rect : null;
}
