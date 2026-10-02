import { useLayoutEffect, type RefObject } from 'react';
import { findSpotlightTarget } from './useSpotlight';

type StyleRestore = { element:HTMLElement; property:string; value:string; priority:string; applied:string };

/** Freeze native scrollbars too, not just wheel/keyboard events. Preserve gutter and scroll position. */
export function useGuideScrollLock(selector:string, relatedSelector:string | undefined,
  viewport:RefObject<HTMLDivElement | null>, enabled:boolean, surfaceKey?:string | null) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const elements = new Set<HTMLElement>();
    for (const target of [findSpotlightTarget(selector, viewport.current, surfaceKey),
      relatedSelector ? findSpotlightTarget(relatedSelector, viewport.current) : null]) {
      if (!target) continue;
      for (let element: HTMLElement | null = target; element; element = element.parentElement) elements.add(element);
      for (const element of target.querySelectorAll<HTMLElement>('*')) elements.add(element);
    }
    const styles: StyleRestore[] = [];
    const freeze = (element:HTMLElement, property:string, applied:string) => {
      styles.push({ element, property, applied, value:element.style.getPropertyValue(property), priority:element.style.getPropertyPriority(property) });
    };
    // Read all geometry before writing styles, avoiding per-element layout thrash.
    for (const element of elements) {
      const horizontal = element.scrollWidth > element.clientWidth;
      const vertical = element.scrollHeight > element.clientHeight;
      if (!horizontal && !vertical) continue;
      const computed = getComputedStyle(element);
      const x = horizontal && /^(auto|scroll)$/.test(computed.overflowX || computed.overflow);
      const y = vertical && /^(auto|scroll)$/.test(computed.overflowY || computed.overflow);
      if (!x && !y) continue;
      if (y && (!computed.scrollbarGutter || computed.scrollbarGutter === 'auto')) freeze(element, 'scrollbar-gutter', 'stable');
      if (x) freeze(element, 'overflow-x', 'hidden');
      if (y) freeze(element, 'overflow-y', 'hidden');
    }
    for (const style of styles) style.element.style.setProperty(style.property, style.applied, 'important');
    return () => {
      for (const { element, property, value, priority, applied } of styles) {
        // Do not overwrite a later change made by the business component itself.
        if (element.style.getPropertyValue(property) !== applied || element.style.getPropertyPriority(property) !== 'important') continue;
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    };
  }, [selector, relatedSelector, viewport, enabled, surfaceKey]);
}
