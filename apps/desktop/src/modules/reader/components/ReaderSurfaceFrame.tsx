import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useAppearance } from '@/shared/components/AppearanceProvider';

/** Owns toolbar geometry and transient material only. Each existing body retains its scroll and input handlers. */
export function ReaderSurfaceFrame({ toolbar, children, className }: {
  toolbar: ReactNode; children: ReactNode; className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { appearance } = useAppearance();

  useLayoutEffect(() => {
    const frame = frameRef.current, toolbar = toolbarRef.current;
    if (appearance !== 'liquid-glass' || !frame || !toolbar) return;
    let animation = 0, idle = 0;
    let scrollTop = 0;
    const measure = () => {
      // offsetHeight uses layout pixels, so CSS zoom and split widths do not double the inset.
      frame.style.setProperty('--reader-toolbar-height', `${toolbar.offsetHeight}px`);
    };
    const paint = () => {
      animation = 0;
      frame.dataset.readerScrolled = String(scrollTop > 8);
    };
    const scroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.hasAttribute('data-reader-scroll')
        || target.closest('[data-reader-frame]') !== frame) return;
      scrollTop = target.scrollTop;
      if (!animation) animation = requestAnimationFrame(paint);
      frame.dataset.readerScrolling = 'true';
      window.clearTimeout(idle);
      idle = window.setTimeout(() => { frame.dataset.readerScrolling = 'false'; }, 160);
    };
    measure();
    scrollTop = frame.querySelector<HTMLElement>('[data-reader-scroll]')?.scrollTop ?? 0;
    paint();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(toolbar);
    frame.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      resize?.disconnect();
      cancelAnimationFrame(animation); window.clearTimeout(idle);
      frame.removeEventListener('scroll', scroll, true);
      frame.style.removeProperty('--reader-toolbar-height');
      delete frame.dataset.readerScrolled; delete frame.dataset.readerScrolling;
    };
  }, [appearance]);

  return <div ref={frameRef} data-reader-frame className={cn('reader-surface-frame relative grid size-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden', className)}>
    <div ref={toolbarRef} data-material="reader-toolbar" className="reader-surface-toolbar min-w-0">{toolbar}</div>
    {children}
  </div>;
}
