import { useEffect, useRef, useState, type RefObject } from 'react';
import { browserCommand, listenBrowser, nativeBrowserAvailable, type BrowserEvent } from '@/shared/ipc/browserApi';

/** The DOM owns geometry; the isolated WebView owns page scrolling/history. No page-to-host bridge. */
export function useBrowserViewport(id: string, viewport: RefObject<HTMLDivElement>, active: boolean, onEvent: (event: BrowserEvent) => void) {
  const native = nativeBrowserAvailable();
  const [error, setError] = useState<string | null>(null);
  const [covered, setCovered] = useState(false);
  const eventRef = useRef(onEvent); eventRef.current = onEvent;
  const activeRef = useRef(active); activeRef.current = active;
  const session = useRef<{ live: boolean; created: boolean; queue: Promise<unknown>; lastLayout: string }>({ live: false, created: false, queue: Promise.resolve(), lastLayout: '' });
  const syncRef = useRef<() => void>(() => {});
  const enqueue = (job: () => Promise<unknown>) => {
    const owner = session.current;
    const task = owner.queue.catch(() => {}).then(() => owner.live ? job() : undefined);
    owner.queue = task; return task;
  };
  useEffect(() => {
    if (!native) return;
    const owner = { live: true, created: false, queue: session.current.queue, lastLayout: '' };
    session.current = owner;
    let frame = 0; let unlisten: (() => void) | undefined;
    const fail = () => { if (owner.live) setError('网页连接失败，请重新打开网页标签重试。'); };
    const sync = () => {
      frame = 0;
      if (!owner.live) return;
      const rect = viewport.current?.getBoundingClientRect();
      const overlay = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')]
        .some(element => {
          if (element.closest('[hidden], [data-state="closed"]')) return false;
          const content = element.querySelector<HTMLElement>('[data-state]');
          if (content?.dataset.state === 'closed') return false;
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          // A tab tooltip outside the page does not cover the native view.
          if (element.querySelector('[role="tooltip"]') && rect) {
            const box = element.getBoundingClientRect();
            return box.right > rect.left && box.left < rect.right && box.bottom > rect.top && box.top < rect.bottom;
          }
          return true;
        });
      // Tab reordering does not obscure the page. Keep the WebView and its scroll/history alive.
      const dragging = Boolean(document.querySelector('.is-sidebar-resizing, .is-resizing'));
      const visible = activeRef.current && !document.hidden && !overlay && !dragging && Boolean(rect && rect.width >= 1 && rect.height >= 1);
      setCovered(overlay || dragging);
      if (!owner.created || !rect) return;
      const bounds = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      const key = visible ? JSON.stringify(bounds) : 'hidden';
      if (key === owner.lastLayout) return; owner.lastLayout = key;
      void enqueue(() => browserCommand(id, 'layout', { visible, bounds })).catch(() => {
        if (owner.lastLayout === key) owner.lastLayout = '';
        fail();
      });
    };
    const schedule = () => { if (owner.live && !frame) frame = requestAnimationFrame(sync); };
    syncRef.current = schedule;
    const resize = new ResizeObserver(schedule); if (viewport.current) resize.observe(viewport.current);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'hidden'] });
    window.addEventListener('resize', schedule); document.addEventListener('visibilitychange', schedule);
    window.addEventListener('neuink:reader-surface-change', schedule);
    void listenBrowser(event => { if (owner.live && event.id === id) eventRef.current(event); }).then(stop => { if (owner.live) unlisten = stop; else stop(); }).catch(fail);
    schedule();
    return () => {
      owner.live = false; unlisten?.(); cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect();
      window.removeEventListener('resize', schedule); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('neuink:reader-surface-change', schedule);
      // Close after any in-flight creation: a late response must never leave an orphan WebView.
      owner.queue = owner.queue.catch(() => {}).then(() => browserCommand(id, 'close')).catch(() => {});
    };
  }, [id, native, viewport]);
  useEffect(() => { syncRef.current(); }, [active]);
  const navigate = async (url: string) => {
    setError(null);
    await enqueue(async () => {
      const owner = session.current;
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) throw new Error('网页区域未就绪');
      if (!owner.created) {
        await browserCommand(id, 'create', { url, bounds: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height) } });
        owner.created = true; owner.lastLayout = ''; syncRef.current();
      } else { await browserCommand(id, 'navigate', { url }); }
    });
  };
  const action = (action: 'back' | 'forward' | 'reload' | 'stop') => enqueue(() => browserCommand(id, action));
  return { native, error, covered, navigate, action };
}
