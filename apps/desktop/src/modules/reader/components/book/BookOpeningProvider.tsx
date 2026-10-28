import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import { BookVolume } from './BookVolume';
import { markBookOpening } from './bookOpeningSession';
import { openingBookOffset } from './bookOpeningGeometry';

type Book = { id: string; title: string; tags: string[] };
type Request = { book: Book; source: HTMLElement; rect: DOMRect; spine: boolean; commit: () => void };
type Begin = (book: Book, source: HTMLElement, commit: () => void) => void;
const Context = createContext<Begin>((_book, _source, commit) => commit());
export const useBookOpening = () => useContext(Context);

/** Owns the shelf-to-tab handoff, so opening a tab cannot unmount its animation. */
export function BookOpeningProvider({ children }: { children: ReactNode }) {
  const { appearance } = useAppearance();
  const [request, setRequest] = useState<Request | null>(null);
  const busy = useRef(false);
  const begin = useCallback<Begin>((book, source, commit) => {
    if (busy.current) return;
    const rect = source.getBoundingClientRect();
    if (appearance !== 'atelier' || !rect.width || !rect.height || typeof source.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)').matches) {
      markBookOpening(book.id); commit(); return;
    }
    busy.current = true;
    setRequest({ book, source, rect, spine: source.classList.contains('library-book-standing'), commit });
  }, [appearance]);
  const close = useCallback(() => { busy.current = false; setRequest(null); }, []);
  useEffect(() => { if (appearance !== 'atelier') close(); }, [appearance, close]);
  return <Context.Provider value={begin}>{children}{request && <Opening key={request.book.id} request={request} close={close} />}</Context.Provider>;
}

function Opening({ request, close }: { request: Request; close: () => void }) {
  const stage = useRef<HTMLDivElement | null>(null), mover = useRef<HTMLDivElement>(null);
  const committed = useRef(false);
  const [phase, setPhase] = useState('正在取出书本');
  const [mounted, setMounted] = useState(false);
  const bindStage = useCallback((element: HTMLDivElement | null) => { stage.current = element; setMounted(Boolean(element)); }, []);
  useLayoutEffect(() => {
    const viewport = stage.current, book = mover.current;
    if (!viewport || !book) return;
    const volume = book.querySelector<HTMLElement>('.book-volume-body')!;
    const cover = book.querySelector<HTMLElement>('.book-volume-front')!;
    const animations: Animation[] = [];
    let cancelled = false;
    const originalVisibility = request.source.style.visibility;
    request.source.style.visibility = 'hidden';
    const animate = (element: HTMLElement, frames: Keyframe[], duration: number, easing = 'cubic-bezier(.22,.7,.2,1)') => {
      const value = element.animate(frames, { duration, easing, fill: 'forwards' }); animations.push(value); return value.finished;
    };
    const root = viewport.getBoundingClientRect(), scale = root.width / viewport.clientWidth || 1;
    const width = Math.min(300, viewport.clientWidth * .33), height = Math.min(440, viewport.clientHeight * .66);
    book.style.width = `${width}px`; book.style.height = `${height}px`;
    const originX = (request.rect.left + request.rect.width / 2 - root.left) / scale - width / 2;
    const originY = (request.rect.top + request.rect.height / 2 - root.top) / scale - height / 2;
    const initialScale = request.rect.height / scale / height;
    const x = (viewport.clientWidth - width) / 2, y = (viewport.clientHeight - height) / 2;
    const perspective = parseFloat(getComputedStyle(viewport).perspective) || 1600;
    const openedX = x + openingBookOffset(width, 158, perspective);
    const coverFrames = Array.from({ length: 33 }, (_, index) => {
      const offset = index / 32;
      return { offset, transform: `rotateY(${-158 * offset}deg)` };
    });
    const centerFrames = Array.from({ length: 33 }, (_, index) => {
      const offset = index / 32;
      return { offset, transform: `translate(${x + openingBookOffset(width, 158 * offset, perspective)}px,${y}px)` };
    });
    const pose = request.spine ? 'rotateX(0deg) rotateY(88deg) rotateZ(0deg)' : 'rotateX(0deg) rotateY(-6deg) rotateZ(-1deg)';
    const finish = () => {
      if (!committed.current) { committed.current = true; markBookOpening(request.book.id); request.commit(); }
    };
    void (async () => {
      await Promise.all([
        animate(book, [{ transform: `translate(${originX}px,${originY}px) scale(${initialScale})` },
          { transform: `translate(${originX}px,${originY - 20}px) scale(${initialScale * 1.05})`, offset: .25 },
          { transform: `translate(${x}px,${y}px) scale(1)` }], 620),
        animate(volume, [{ transform: pose }, { transform: 'rotateX(4deg) rotateY(-12deg) rotateZ(0deg)' }], 620),
      ]);
      if (cancelled) return;
      setPhase('正在翻开封面');
      // A short readable pause before the front board swings on its binding.
      await animate(volume, [{ transform: 'rotateX(4deg) rotateY(-12deg)' }, { transform: 'rotateX(0deg) rotateY(0deg)' }], 240);
      await Promise.all([
        animate(cover, coverFrames, 680),
        animate(book, centerFrames, 680),
      ]);
      if (cancelled) return;
      setPhase('正在进入阅读'); finish();
      await animate(book, [{ opacity: 1, transform: `translate(${openedX}px,${y}px)` },
        { opacity: 0, transform: `translate(${openedX}px,${y}px)` }], 260);
      if (!cancelled) close();
    })().catch(() => { if (!cancelled) { finish(); close(); } });
    const interrupt = () => { if (!cancelled) close(); };
    window.addEventListener('resize', interrupt);
    const hide = () => { if (document.hidden) interrupt(); };
    document.addEventListener('visibilitychange', hide);
    return () => { cancelled = true; animations.forEach(value => value.cancel()); request.source.style.visibility = originalVisibility;
      window.removeEventListener('resize', interrupt); document.removeEventListener('visibilitychange', hide); };
  }, [request, close, mounted]);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="book-opening-stage" overlayClassName="book-opening-shade" showCloseButton={false}
      aria-describedby={undefined}
      onCloseAutoFocus={event => { event.preventDefault(); if (committed.current) Array.from(document.querySelectorAll<HTMLElement>('[data-reader-scroll]')).find(element => element.getClientRects().length)?.focus({ preventScroll: true }); else request.source.closest<HTMLElement>('[data-book-index]')?.focus({ preventScroll: true }); }}>
      <div ref={bindStage} className="book-opening-viewport">
        <DialogTitle className="sr-only">打开《{request.book.title}》</DialogTitle>
        <div ref={mover} className="book-opening-mover"><BookVolume id={request.book.id} title={request.book.title} topic={request.book.tags[0] || '研究札记'} bookmark /></div>
        <div className="book-opening-status"><span role="status">{phase}</span><Button size="sm" variant="outline" onClick={close}>取消</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}
