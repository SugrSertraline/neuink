import { useLayoutEffect, useRef, useState } from 'react';

type Layout = { visibleCount: number; primaryCollapsed: boolean };
type Widths = { available: number; primary: number; language: number; menu: number; tools: number[]; gap: number };

export function fitReflowToolbar({ available, primary, language, menu, tools, gap }: Widths): Layout {
  const required = (widths: number[]) => {
    const visible = widths.filter(width => width > 0);
    return visible.reduce((sum, width) => sum + width, 0) + Math.max(0, visible.length - 1) * gap;
  };
  if (required([primary, ...tools, language]) <= available) return { visibleCount: tools.length, primaryCollapsed: false };
  if (required([primary, language, menu]) > available) return { visibleCount: 0, primaryCollapsed: true };
  let visibleCount = 0;
  while (visibleCount < tools.length && required([primary, ...tools.slice(0, visibleCount + 1), language, menu]) <= available) visibleCount++;
  return { visibleCount, primaryCollapsed: false };
}

/** Measure the single mounted set of controls in layout pixels, unaffected by CSS UI zoom. */
export function useReflowToolbarLayout(compact: boolean, menuOpen: boolean, structureKey: string) {
  const rowRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = useState<Layout>({ visibleCount: Infinity, primaryCollapsed: false });
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (compact || !row || menuOpen) return;
    const tools = [...row.querySelectorAll<HTMLElement>('[data-reflow-toolbar-item]')];
    let disposed = false;
    const measure = () => {
      // A hidden reader pane must not replace its last useful layout with zero widths.
      if (disposed || !row.clientWidth) return;
      if (row.querySelector('[aria-expanded="true"]')) return;
      const style = getComputedStyle(row);
      const scale = row.offsetWidth ? row.getBoundingClientRect().width / row.offsetWidth : 1;
      const widthOf = (element: HTMLElement | null) => element
        ? Math.ceil(element.getBoundingClientRect().width / (scale || 1) || element.offsetWidth) : 0;
      const next = fitReflowToolbar({
        available: row.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0),
        primary: widthOf(primaryRef.current),
        language: widthOf(languageRef.current),
        menu: widthOf(menuRef.current),
        tools: tools.map(widthOf), gap: parseFloat(style.columnGap) || 0
      });
      setLayout(current => current.visibleCount === next.visibleCount && current.primaryCollapsed === next.primaryCollapsed ? current : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const element of [row, primaryRef.current, languageRef.current, menuRef.current, ...tools]) if (element) observer.observe(element);
    const menus = new MutationObserver(measure);
    menus.observe(row, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
    return () => { disposed = true; observer.disconnect(); menus.disconnect(); };
    // Keep an open menu stable while it owns focus; measure its controls again on close.
  }, [compact, menuOpen, structureKey]);
  useLayoutEffect(() => {
    const active = document.activeElement;
    const hidden = active?.closest('[aria-hidden="true"]');
    if (!hidden || !rowRef.current?.contains(hidden)) return;
    const target = menuRef.current?.getAttribute('aria-hidden') === 'true'
      ? [...rowRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')].find(control => !control.closest('[aria-hidden="true"]'))
      : menuRef.current;
    target?.focus({ preventScroll: true });
  }, [layout]);
  return { ...layout, rowRef, primaryRef, languageRef, menuRef };
}
