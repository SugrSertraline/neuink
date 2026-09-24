import { useEffect, type RefObject } from 'react';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import type { BookStage } from './bookScene';
import type { BookContent } from './bookCoverTexture';
import { createBookCoverMotion } from './bookCoverMotion';

export function useBookStage(hostRef: RefObject<HTMLDivElement>, content: BookContent, enabled: boolean, mode: 'shelf' | 'overview') {
  const { appearance } = useAppearance();
  const { title, topic, bookmark } = content;
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled || appearance !== 'atelier' || typeof window.matchMedia !== 'function'
      || typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined') return;
    const target = host.closest<HTMLElement>('.library-shelf-entry') ?? host;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
    let stage: BookStage | null = null, visible = false, entered = false, focused = false, cancelled = false, loading = false, failed = false, generation = 0, idle = 0;
    const stop = () => { generation++; loading = false; window.clearTimeout(idle); stage?.dispose(); stage = null; };
    const eligible = () => !cancelled && !failed && visible && !document.hidden && !reduced.matches && !target.classList.contains('is-dragging');
    const activate = async () => {
      if (!eligible() || stage || loading) return;
      if (mode === 'shelf') { stage = createBookCoverMotion(host); return; }
      loading = true; const ticket = ++generation;
      try {
        const { createBookStage } = await import('./bookScene');
        if (ticket !== generation || !eligible()) return;
        stage = createBookStage(host, { title, topic, bookmark }, () => { failed = true; stage = null; });
        if (entered || focused) stage.point(0, 0);
      } catch { if (ticket === generation && !cancelled) { failed = true; host.dataset.bookFallback = 'true'; } }
      finally { if (ticket === generation) loading = false; }
    };
    const sync = () => { if (eligible() && (mode === 'overview' || entered || focused)) void activate(); else stop(); };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      entered = true; window.clearTimeout(idle); sync(); stage?.point(0, 0);
    };
    const leave = () => {
      entered = false; stage?.rest();
      if (mode === 'shelf' && !focused) idle = window.setTimeout(stop, 320);
    };
    const move = (event: PointerEvent) => {
      if (event.buttons || event.pointerType === 'touch') { stop(); return; }
      if (!eligible()) return;
      if (!stage) void activate();
      if (!stage) return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      stage.point((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
    };
    const focus = () => { focused = true; window.clearTimeout(idle); sync(); stage?.point(0, 0); };
    const blur = (event: FocusEvent) => { if (!target.contains(event.relatedTarget as Node)) { focused = false; if (!entered && mode === 'shelf') stop(); } };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { entered = false; focused = false; stop(); } };
    const reset = () => { entered = false; focused = false; stop(); };
    const resume = () => { focused = target.contains(document.activeElement); sync(); };
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync(); });
    intersection.observe(host);
    const resize = new ResizeObserver(() => stage?.resize()); resize.observe(host);
    target.addEventListener('pointerenter', enter, { passive: true }); target.addEventListener('pointerleave', leave, { passive: true });
    target.addEventListener('pointermove', move, { passive: true }); target.addEventListener('pointerdown', stop, { passive: true });
    target.addEventListener('focusin', focus); target.addEventListener('focusout', blur); target.addEventListener('keydown', key);
    target.addEventListener('dragstart', reset); document.addEventListener('visibilitychange', sync);
    window.addEventListener('blur', reset); window.addEventListener('focus', resume); reduced.addEventListener('change', sync);
    return () => {
      cancelled = true; stop(); intersection.disconnect(); resize.disconnect(); delete host.dataset.bookFallback;
      target.removeEventListener('pointerenter', enter); target.removeEventListener('pointerleave', leave); target.removeEventListener('pointermove', move); target.removeEventListener('pointerdown', stop);
      target.removeEventListener('focusin', focus); target.removeEventListener('focusout', blur); target.removeEventListener('keydown', key); target.removeEventListener('dragstart', reset);
      document.removeEventListener('visibilitychange', sync); window.removeEventListener('blur', reset); window.removeEventListener('focus', resume); reduced.removeEventListener('change', sync);
    };
  }, [appearance, enabled, mode, hostRef, title, topic, bookmark]);
}
