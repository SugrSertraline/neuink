import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { BookVolume } from '../book/BookVolume';

/** Live cover faces share the PDF's measured geometry, without rasterizing the title. */
export function PdfBookModel({ id, title, topic, open, onOpen, layoutKey }: {
  id: string; title: string; topic: string; open: boolean; onOpen: () => void; layoutKey: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 300, height: 420, left: 0, top: 0 });
  const [settled, setSettled] = useState(open);
  const previous = useRef(open);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      const surface = element.parentElement?.querySelector<HTMLElement>('[data-book-spread] [data-pdf-page-surface]');
      if (!surface || !element.clientWidth) return;
      const rect = surface.getBoundingClientRect(), root = element.getBoundingClientRect(), scale = root.width / element.clientWidth || 1;
      if (!rect.width || !rect.height) return;
      const width = rect.width / scale, height = rect.height / scale;
      setGeometry({ width, height, left: (element.clientWidth - width) / 2, top: (rect.top - root.top) / scale });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [layoutKey]);
  useLayoutEffect(() => {
    const changed = previous.current !== open; previous.current = open;
    if (!changed || !open || window.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)').matches) { setSettled(open); return; }
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), 720);
    return () => clearTimeout(timer);
  }, [open]);
  return <div ref={host} className="pdf-live-book" data-open={open} data-settled={settled}>
    <div className="pdf-live-book-volume" style={{ left: geometry.left, top: geometry.top,
      '--live-book-width': `${geometry.width}px`, '--live-book-height': `${geometry.height}px` } as CSSProperties}>
      <BookVolume id={id} title={title} topic={topic} open={open} bookmark />
    </div>
    {!open && <Button variant="plain" className="pdf-live-book-open" style={{ left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height }}
      onClick={onOpen} aria-label={`打开书本：${title}`}><span>打开书本</span></Button>}
  </div>;
}
