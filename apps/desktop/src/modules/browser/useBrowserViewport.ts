import { useEffect, useRef, useState, type RefObject } from 'react';
import { browserCommand, listenBrowser, nativeBrowserAvailable, type BrowserBounds, type BrowserEvent, type BrowserOcclusion } from '@/shared/ipc/browserApi';

type PendingLayout = { key: string; visible: boolean; bounds: BrowserBounds; occlusions?: BrowserOcclusion[] };
type ViewportSession = { live: boolean; created: boolean; queue: Promise<unknown>; lastLayout: string;
  pendingLayout: PendingLayout | null; layoutQueued: boolean };

function nativeBounds(rect: DOMRect): BrowserBounds {
  // devicePixelRatio belongs to the host, not the independently zoomed remote page.
  const ratio = window.devicePixelRatio;
  return { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height),
    pixel_ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1 };
}

const TASK_DOCK_SELECTOR = '[data-native-browser-overlay="task-dock"]';

function taskDockOcclusions(panels: Set<HTMLElement>, bounds: BrowserBounds): BrowserOcclusion[] {
  const occlusions: BrowserOcclusion[] = [];
  for (const panel of panels) {
    if (panel.closest('[hidden], [aria-hidden="true"], [data-state="closed"]')) continue;
    const style = getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') continue;
    const rect = panel.getBoundingClientRect();
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
    // Both rectangles are in host viewport CSS pixels. Native code applies the host pixel ratio once.
    // Clip only the actual panel. Expanding for its shadow exposes the host
    // surface around the native webpage as an unwanted solid background ring.
    const x = Math.max(bounds.x, rect.x);
    const y = Math.max(bounds.y, rect.y);
    const right = Math.min(bounds.x + bounds.width, rect.x + rect.width);
    const bottom = Math.min(bounds.y + bounds.height, rect.y + rect.height);
    if (right > x && bottom > y) occlusions.push({ x, y, width: right - x, height: bottom - y });
  }
  return occlusions;
}

/** The DOM owns geometry; the isolated WebView owns page scrolling/history. No page-to-host bridge. */
export function useBrowserViewport(id: string, viewport: RefObject<HTMLDivElement>, active: boolean, onEvent: (event: BrowserEvent) => void) {
  const native = nativeBrowserAvailable();
  const [error, setError] = useState<string | null>(null);
  const eventRef = useRef(onEvent); eventRef.current = onEvent;
  const activeRef = useRef(active); activeRef.current = active;
  const session = useRef<ViewportSession>({ live: false, created: false, queue: Promise.resolve(), lastLayout: '', pendingLayout: null, layoutQueued: false });
  const syncRef = useRef<() => void>(() => {});
  const enqueue = (job: () => Promise<unknown>) => {
    const owner = session.current;
    const task = owner.queue.catch(() => {}).then(() => owner.live ? job() : undefined);
    owner.queue = task; return task;
  };
  useEffect(() => {
    if (!native) return;
    const owner: ViewportSession = { live: true, created: false, queue: session.current.queue, lastLayout: '', pendingLayout: null, layoutQueued: false };
    session.current = owner;
    let frame = 0; let unlisten: (() => void) | undefined;
    const fail = () => { if (owner.live) setError('网页连接失败，请重新打开网页标签重试。'); };
    const flushLayout = () => {
      if (!owner.live || owner.layoutQueued || !owner.pendingLayout) return;
      owner.layoutQueued = true;
      void enqueue(async () => {
        // Read the newest geometry when the native queue is ready, not at pointer-event time.
        const layout = owner.pendingLayout;
        owner.pendingLayout = null;
        if (!layout || layout.key === owner.lastLayout) return;
        await browserCommand(id, 'layout', { visible: layout.visible, bounds: layout.bounds,
          ...(layout.occlusions ? { occlusions: layout.occlusions } : {}) });
        owner.lastLayout = layout.key;
      }).catch(fail).finally(() => {
        owner.layoutQueued = false;
        // At most one in-flight layout and one latest replacement; no stale-width backlog.
        if (owner.live) flushLayout();
      });
    };
    const sync = () => {
      frame = 0;
      if (!owner.live) return;
      // Observe actual content size as well as portal insertion/positioning; text-only updates can resize it.
      const nextPanels = new Set(document.querySelectorAll<HTMLElement>(TASK_DOCK_SELECTOR));
      for (const panel of panels) if (!nextPanels.has(panel)) { resize.unobserve(panel); panels.delete(panel); }
      for (const panel of nextPanels) if (!panels.has(panel)) { resize.observe(panel); panels.add(panel); }
      const rect = viewport.current?.getBoundingClientRect();
      // Only surface lifecycle controls visibility; overlays and resizing keep the page alive and visible.
      const visible = activeRef.current && !document.hidden && Boolean(rect && rect.width >= 1 && rect.height >= 1);
      if (!owner.created || !rect) return;
      const bounds = nativeBounds(rect);
      const occlusions = visible ? taskDockOcclusions(panels, bounds) : [];
      const key = visible ? JSON.stringify({ bounds, occlusions }) : 'hidden';
      if (!owner.layoutQueued && key === owner.lastLayout) return;
      owner.pendingLayout = { key, visible, bounds, ...(occlusions.length ? { occlusions } : {}) };
      flushLayout();
    };
    const schedule = () => { if (owner.live && !frame) frame = requestAnimationFrame(sync); };
    syncRef.current = schedule;
    const panels = new Set<HTMLElement>();
    const resize = new ResizeObserver(schedule); if (viewport.current) resize.observe(viewport.current);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'data-state', 'hidden', 'aria-hidden', 'data-native-browser-overlay'] });
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', schedule); document.addEventListener('visibilitychange', schedule);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('neuink:reader-surface-change', schedule);
    void listenBrowser(event => { if (owner.live && event.id === id) eventRef.current(event); }).then(stop => { if (owner.live) unlisten = stop; else stop(); }).catch(fail);
    schedule();
    return () => {
      owner.live = false; owner.pendingLayout = null; unlisten?.(); cancelAnimationFrame(frame); resize.disconnect(); panels.clear(); mutation.disconnect();
      window.removeEventListener('resize', schedule); document.removeEventListener('visibilitychange', schedule); window.removeEventListener('neuink:reader-surface-change', schedule);
      document.removeEventListener('scroll', schedule, true);
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
        await browserCommand(id, 'create', { url, bounds: nativeBounds(rect) });
        owner.created = true; owner.lastLayout = ''; syncRef.current();
      } else { await browserCommand(id, 'navigate', { url }); }
    });
  };
  const action = (action: 'back' | 'forward' | 'reload' | 'stop') => enqueue(() => browserCommand(id, action));
  const zoom = async (factor: number) => {
    if (!native || !session.current.live || !session.current.created) throw new Error('网页尚未就绪，暂时无法缩放。');
    if (!Number.isFinite(factor) || factor < 0.5 || factor > 3) throw new Error('网页缩放范围为 50%–300%。');
    // The same owner queue preserves navigation order and discards work after the tab closes.
    await enqueue(() => browserCommand(id, 'zoom', { zoom: factor }));
  };
  return { native, error, navigate, action, zoom };
}
