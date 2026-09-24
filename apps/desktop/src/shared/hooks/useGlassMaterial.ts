import { useEffect } from 'react';
import { createGlassOptics } from '../lib/glassOptics';

const controls = '[data-ui="button"], [data-ui="toggle"], [data-ui="toggle-group-item"], [data-slot="tabs-trigger"], [data-slot="select-trigger"], [data-slot="input"], [data-slot="textarea"], [data-slot="switch"], [data-slot="checkbox"], .title-search, .activitybar button, .workspace-surface-tab';
const portals = '[data-slot="dialog-content"], [data-slot="popover-content"], [data-slot="hover-card-content"], [data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"], [data-slot="select-content"]';
const opticalSurfaces = `${portals}, [data-material="reader-toolbar"], [data-material="reader-popover"]`;
// Match the CSS material owners: their children already see a filtered backdrop.
const materialContainers = `${opticalSurfaces}, .titlebar, .app-sidebar, .tabsbar, .statusbar, [data-material="workspace-heading"], [data-material="workspace-toolbar"], .reflow-toolbar > .entry-content-header, .reflow-toolbar > [data-reader-compact-toolbar]`;
const surfaces = `${opticalSurfaces}, [data-material="section-heading"], [data-material="sidebar-toolbar"], .titlebar, .tabsbar`;
const preferences = ['(prefers-reduced-motion: reduce)', '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)'];

/** Appearance owns transient light only. Passive events never change focus, pointer capture, scroll or drag state. */
export function useGlassMaterial(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const media = preferences.map(query => window.matchMedia?.(query)).filter((query): query is MediaQueryList => Boolean(query));
    let stop: (() => void) | undefined;
    const refresh = () => {
      stop?.(); stop = undefined;
      // Static CSS glass remains when motion is reduced; no live lighting/optics work is scheduled.
      if (!media.some(query => query.matches)) stop = installMaterial();
    };
    media.forEach(query => query.addEventListener('change', refresh));
    refresh();
    return () => { stop?.(); media.forEach(query => query.removeEventListener('change', refresh)); };
  }, [enabled]);
}

function installMaterial() {
  // SVG backdrop displacement is used only in Chromium/WebView2; other engines keep CSS blur and specular light.
  const supportsLens = /Chrome|Chromium|Edg\//.test(navigator.userAgent)
    && typeof ResizeObserver !== 'undefined' && window.CSS?.supports('backdrop-filter', 'url(#glass)');
  const optics = supportsLens ? createGlassOptics() : undefined;
  const popupElements = new Set<HTMLElement>();
  let lit: HTMLElement[] = [], hovered: HTMLElement | null = null;
  let frame = 0, sample: { target: Element; x: number; y: number } | null = null;

  const clearLight = (element: HTMLElement) => {
    element.removeAttribute('data-glass-light');
    element.removeAttribute('data-glass-positioned');
    ['--glass-pointer-x', '--glass-pointer-y', '--glass-light-angle'].forEach(property => element.style.removeProperty(property));
  };
  const reset = () => {
    cancelAnimationFrame(frame); frame = 0; sample = null;
    lit.forEach(clearLight); lit = [];
    if (hovered && !popupElements.has(hovered)) optics?.remove(hovered);
    hovered = null;
  };
  const paint = () => {
    frame = 0;
    if (!sample || !sample.target.isConnected) { reset(); return; }
    const control = sample.target.closest<HTMLElement>(controls);
    const eligible = control && !control.matches(':disabled, [aria-disabled="true"], [readonly], [data-variant="link"]') ? control : null;
    const surface = sample.target.closest<HTMLElement>(surfaces);
    const next = [...new Set([eligible, surface].filter((element): element is HTMLElement => Boolean(element)))];
    lit.filter(element => !next.includes(element)).forEach(clearLight);
    const opticalControl = eligible && !eligible.parentElement?.closest(materialContainers) ? eligible : null;
    if (hovered !== opticalControl) {
      if (hovered && !popupElements.has(hovered)) optics?.remove(hovered);
      hovered = opticalControl;
      if (opticalControl) optics?.add(opticalControl);
    }
    next.forEach(element => {
      if (getComputedStyle(element).position === 'static') element.setAttribute('data-glass-positioned', '');
      const bounds = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (sample!.x - bounds.left) / Math.max(1, bounds.width)));
      const y = Math.max(0, Math.min(1, (sample!.y - bounds.top) / Math.max(1, bounds.height)));
      element.style.setProperty('--glass-pointer-x', `${(x * 100).toFixed(1)}%`);
      element.style.setProperty('--glass-pointer-y', `${(y * 100).toFixed(1)}%`);
      element.style.setProperty('--glass-light-angle', `${Math.round(Math.atan2(y - 0.5, x - 0.5) * 180 / Math.PI + 90)}deg`);
      element.setAttribute('data-glass-light', 'active');
    });
    lit = next;
  };
  const pointer = (event: PointerEvent) => {
    if (event.buttons || event.pointerType === 'touch' || !(event.target instanceof Element)) { reset(); return; }
    sample = { target: event.target, x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const leave = (event: PointerEvent) => { if (!event.relatedTarget) reset(); };
  // Observe portal/reader-toolbar mounts, not style/attribute changes or each row in a long list.
  const discover = (node: Node) => {
    if (!(node instanceof Element)) return;
    const candidates = [...node.querySelectorAll<HTMLElement>(opticalSurfaces)];
    if (node instanceof HTMLElement && node.matches(opticalSurfaces)) candidates.push(node);
    candidates.forEach(element => { popupElements.add(element); optics?.add(element); });
  };
  const mutations = optics ? new MutationObserver(records => {
    popupElements.forEach(element => {
      if (!element.isConnected) { optics.remove(element); popupElements.delete(element); }
    });
    if (lit.some(element => !element.isConnected)) reset();
    records.forEach(record => record.addedNodes.forEach(discover));
  }) : undefined;
  if (optics) { discover(document.body); mutations?.observe(document.body, { childList: true, subtree: true }); }
  document.addEventListener('pointermove', pointer, { passive: true });
  document.addEventListener('pointerup', pointer, { passive: true });
  document.addEventListener('pointerout', leave, { passive: true });
  document.addEventListener('pointerdown', reset, { passive: true, capture: true });
  document.addEventListener('pointercancel', reset, { passive: true });
  document.addEventListener('scroll', reset, { passive: true, capture: true });
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('blur', reset);
  return () => {
    mutations?.disconnect(); reset(); optics?.dispose();
    document.removeEventListener('pointermove', pointer);
    document.removeEventListener('pointerup', pointer);
    document.removeEventListener('pointerout', leave);
    document.removeEventListener('pointerdown', reset, true);
    document.removeEventListener('pointercancel', reset);
    document.removeEventListener('scroll', reset, true);
    document.removeEventListener('visibilitychange', reset);
    window.removeEventListener('blur', reset);
  };
}
