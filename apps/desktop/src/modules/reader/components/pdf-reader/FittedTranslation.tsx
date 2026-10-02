import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Measure the actual rendered Markdown, never enlarge beyond the page's base size. */
export function fitTranslation(node: HTMLElement, preferred: number) {
  if (!node.clientWidth || !node.clientHeight) return;
  const apply = (size: number) => { node.style.fontSize = `${size}px`; node.style.lineHeight = '1.25'; };
  const fits = () => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth;
  apply(preferred);
  if (fits()) return;
  let low = 0.5, high = preferred;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    apply(mid);
    if (fits()) low = mid; else high = mid;
  }
  apply(low);
}

export function FittedTranslation({ fontSize, children, missing = false }: { fontSize: number; children: ReactNode; missing?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let alive = true;
    const fit = () => { if (alive) fitTranslation(node, fontSize); };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(node);
    void document.fonts?.ready.then(fit);
    return () => { alive = false; observer?.disconnect(); };
  }, [fontSize, children]);
  return <div ref={ref} className="translation-replacement-preview pointer-events-auto min-h-0 min-w-0 flex-1 overflow-hidden font-sans"
    title={missing ? '缺少翻译' : '译文；悬停可查看完整内容'}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    style={{ fontSize, lineHeight: 1.25 }}>{children}</div>;
}
