import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { dismissHoverInteractions } from '@/components/ui/hover-interactions';
import { findSpotlightTarget, type SpotlightRect } from './useSpotlight';
import { measureGuideSpotlight } from './guideGeometry';
import { permitsGuideEvent, PRACTICE_GUIDE, type GuideInteractionPolicy } from './guideInteractionPolicy';

const POPUPS = ['popover-content', 'select-content', 'dropdown-menu-content', 'dropdown-menu-sub-content',
  'context-menu-content', 'context-menu-sub-content', 'hover-card-content', 'tooltip-content'].map(slot => `[data-slot="${slot}"]`).join(',')
  + ',[data-slot="pointer-preview"][aria-label="片段悬停预览"],[data-reading-selection-toolbar]'
  + ',.app-floating-segment-panel:not(.is-hidden)';
const HOVER_POPUPS = '[data-slot="hover-card-content"],[data-slot="tooltip-content"],'
  + '[data-slot="pointer-preview"][aria-label="片段悬停预览"],'
  + '[data-slot="dropdown-menu-sub-content"],[data-slot="context-menu-sub-content"]';
const DIALOGS = '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]';
function visible(element: Element) {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 && element.getAttribute('data-state') !== 'closed'
    && !element.closest('[hidden], [aria-hidden="true"], .is-hidden');
}

/** Block at capture time, before business handlers; release everything on pause or a real modal. */
export function useGuideInteractionBoundary({ selector, viewport, panel, enabled, relatedSelector, highlighted = true, stepKey = selector, interaction = PRACTICE_GUIDE, surfaceKey }: {
  selector:string; viewport:RefObject<HTMLDivElement | null>; panel:RefObject<HTMLElement | null>;
  enabled:boolean; relatedSelector?:string; highlighted?:boolean; stepKey?:string;
  interaction?:GuideInteractionPolicy;
  surfaceKey?:string | null;
}) {
  const [popupRects, setPopupRects] = useState<SpotlightRect[]>([]);
  const highlightedRef = useRef(highlighted); highlightedRef.current = highlighted;
  useLayoutEffect(() => {
    if (!enabled) { setPopupRects([]); return; }
    setPopupRects([]);
    const allowedPopups = new Set<HTMLElement>();
    let beforeTrigger = new Set<Element>();
    let pendingTrigger: 'action' | 'hover' | null = null;
    let triggerExpiresAt = 0;
    let frame = 0;
    // A preview from a previous step must not stay above the new dark region.
    dismissHoverInteractions();
    const targets = () => {
      if (!highlightedRef.current) return [];
      const target = findSpotlightTarget(selector, viewport.current, surfaceKey);
      const related = relatedSelector ? findSpotlightTarget(relatedSelector, viewport.current) : null;
      return [...(target ? [target] : []), ...(related ? [related] : [])];
    };
    const region = (node: Node | null) => {
      if (!node) return null;
      if (panel.current?.contains(node)) return { root:panel.current, kind:'panel' as const };
      const popup = highlightedRef.current && [...allowedPopups].find(element => visible(element) && element.contains(node));
      if (popup) return { root:popup, kind:'popup' as const };
      const target = targets().find(element => element.contains(node));
      return target ? { root:target, kind:'target' as const } : null;
    };
    const inRegion = (node: Node | null) => Boolean(region(node));
    const modal = () => [...document.querySelectorAll(DIALOGS)].some(visible);
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const root = viewport.current;
      if (!root) return;
      for (const popup of allowedPopups) if (!popup.isConnected || !visible(popup)) {
        allowedPopups.delete(popup); resize.unobserve(popup);
      }
      const rectangles = [...allowedPopups].map(popup => measureGuideSpotlight(popup, root))
        .filter((rect): rect is SpotlightRect => Boolean(rect));
      setPopupRects(previous => JSON.stringify(previous) === JSON.stringify(rectangles) ? previous : rectangles);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const discoverPopups = () => {
      if (!highlightedRef.current) return;
      const controls = targets().flatMap(root => interaction.mode === 'practice'
        ? [root, ...root.querySelectorAll('[aria-controls]')]
        : interaction.actionTarget ? [...root.querySelectorAll(interaction.actionTarget)] : []);
      const controlled = new Set(controls
        .flatMap(element => (element.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)));
      let found = false;
      for (const popup of document.querySelectorAll<HTMLElement>(POPUPS)) {
        if (!visible(popup) || allowedPopups.has(popup)) continue;
        const triggered = pendingTrigger && Date.now() <= triggerExpiresAt
          && (pendingTrigger === 'action' || popup.matches(HOVER_POPUPS));
        if (controlled.has(popup.id) || (triggered && !beforeTrigger.has(popup))) {
          allowedPopups.add(popup); resize.observe(popup); found = true;
        }
      }
      if (found) pendingTrigger = null;
      schedule();
    };
    const guard = (event: Event) => {
      if (modal()) return;
      if (event.target instanceof Element && event.target.closest(POPUPS)) discoverPopups();
      const node = event.target instanceof Node ? event.target : document.activeElement;
      if (event instanceof KeyboardEvent && event.key === 'Escape') return;
      if (event instanceof KeyboardEvent && event.key === 'Tab') {
        // Keep native traversal, but do not deliver background keyboard handlers.
        // focusin below redirects any destination outside the permitted regions.
        if (!inRegion(node)) event.stopImmediatePropagation();
        return;
      }
      const area = region(node);
      if (area && (area.kind === 'panel' || permitsGuideEvent(event, interaction, area.root, area.kind === 'popup'))) {
        // Read-only scrolling uses the native scroll owner, not a bubbling reader
        // handler that might zoom, page or otherwise alter another surface.
        if (area.kind !== 'panel' && interaction.mode !== 'practice'
          && (event.type === 'wheel' || event.type === 'touchmove')) event.stopPropagation();
        const action = ['pointerdown', 'mousedown', 'touchstart', 'click', 'contextmenu', 'keydown'].includes(event.type);
        const hover = ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove', 'focusin'].includes(event.type);
        // Preserve the selection/menu action while pointer movement follows a press.
        const actionPending = pendingTrigger === 'action' && Date.now() <= triggerExpiresAt;
        if ((action || (hover && !actionPending)) && !panel.current?.contains(node)) {
          beforeTrigger = new Set([...document.querySelectorAll(POPUPS)].filter(visible));
          pendingTrigger = action ? 'action' : 'hover';
          triggerExpiresAt = Date.now() + 1500;
        }
        return;
      }
      if (['pointerover', 'pointermove', 'mouseover', 'mousemove', 'pointerdown', 'click'].includes(event.type)) pendingTrigger = null;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.type === 'focusin') {
        const focus = panel.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? panel.current;
        focus?.focus({ preventScroll:true });
      }
    };
    const selectionChanged = () => {
      if (modal()) return;
      const selection = window.getSelection();
      // Long selections need their own provenance; an old press may have expired.
      if (interaction.mode === 'practice' && !selection?.isCollapsed && targets().some(target => target.contains(selection?.anchorNode ?? null)
        && target.contains(selection?.focusNode ?? null))) {
        beforeTrigger = new Set([...document.querySelectorAll(POPUPS)].filter(visible));
        pendingTrigger = 'action'; triggerExpiresAt = Date.now() + 1500;
      }
    };
    const events = ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove',
      'pointerdown', 'mousedown', 'touchstart', 'touchmove', 'click', 'auxclick', 'dblclick', 'contextmenu',
      'keydown', 'keypress', 'keyup', 'focus', 'focusin', 'wheel', 'dragstart', 'dragover', 'dragenter', 'drop'];
    // Window capture precedes document-level shortcuts and React portal handlers.
    for (const type of events) window.addEventListener(type, guard, { capture:true, passive:false });
    window.addEventListener('selectionchange', selectionChanged, true);
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element) || !record.target.closest('[data-guide-overlay]'))) discoverPopups();
    });
    mutations.observe(document.body, { childList:true, subtree:true, attributes:true,
      attributeFilter:['aria-controls', 'aria-expanded', 'data-state', 'style', 'hidden', 'class'] });
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    discoverPopups();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
      for (const type of events) window.removeEventListener(type, guard, true);
      window.removeEventListener('selectionchange', selectionChanged, true);
      document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    };
  }, [selector, viewport, panel, enabled, relatedSelector, stepKey, interaction, surfaceKey]);
  return highlighted ? popupRects : [];
}
