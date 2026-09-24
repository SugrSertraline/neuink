import { useEffect, useRef, useState, type RefObject } from 'react';
import type { RelationGraph } from './relationGraph';
import type { NodeProjection } from './relationSceneData';
import type { RelationScene } from './relationScene';
import type { RelationViewState } from './relationPresentation';

export function useRelationScene({ host, viewport, graph, active, selectedId, hoveredId, onProject, onHover, onSelect }: {
  host: RefObject<HTMLDivElement>; viewport: RefObject<HTMLDivElement>; graph: RelationGraph; active: boolean;
  selectedId: string | null; hoveredId: string | null; onProject: (points: NodeProjection[]) => void;
  onHover: (id: string | null) => void; onSelect: (id: string | null) => void;
}) {
  const scene = useRef<RelationScene | null>(null), latest = useRef({ graph, active, selectedId, hoveredId, onProject, onHover, onSelect });
  latest.current = { graph, active, selectedId, hoveredId, onProject, onHover, onSelect };
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'), [attempt, retry] = useState(0);
  const [view, setView] = useState<RelationViewState>({ mode: 'spatial', shown: 0, total: 0 });
  const syncActive = useRef<() => void>(() => {});
  useEffect(() => {
    const element = host.current, view = viewport.current; if (!element || !view) return;
    let cancelled = false, stage: RelationScene | null = null, visible = true, focused = true;
    const activeNow = () => latest.current.active && visible && focused && document.visibilityState !== 'hidden';
    const sync = () => { stage?.setActive(activeNow()); if (!activeNow()) latest.current.onHover(null); };
    syncActive.current = sync;
    const fail = () => { if (cancelled) return; stage?.dispose(); stage = null; scene.current = null; element.replaceChildren(); setStatus('error'); };
    setStatus('loading');
    void import('./relationScene').then(({ createRelationScene }) => {
      if (cancelled) return;
      try {
        stage = createRelationScene(element, view, { project: points => latest.current.onProject(points),
          hover: id => latest.current.onHover(id), select: id => latest.current.onSelect(id), lost: fail, view: setView });
        scene.current = stage; stage.update(latest.current.graph); stage.highlight(latest.current.selectedId, latest.current.hoveredId);
        sync(); setStatus('ready');
      } catch { fail(); }
    }).catch(fail);
    const resize = new ResizeObserver(() => { stage?.resize(); sync(); }); resize.observe(view);
    const visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; sync(); }); visibility?.observe(view);
    const theme = new MutationObserver(() => stage?.refreshColors()); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-appearance'] });
    const blur = () => { focused = false; sync(); }, focus = () => { focused = true; sync(); };
    document.addEventListener('visibilitychange', sync); window.addEventListener('blur', blur); window.addEventListener('focus', focus);
    return () => {
      cancelled = true; syncActive.current = () => {}; resize.disconnect(); visibility?.disconnect(); theme.disconnect();
      document.removeEventListener('visibilitychange', sync); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      stage?.dispose(); scene.current = null;
    };
  }, [host, viewport, attempt]);
  useEffect(() => { scene.current?.update(graph); }, [graph]);
  useEffect(() => { scene.current?.highlight(selectedId, hoveredId); }, [selectedId, hoveredId]);
  useEffect(() => { syncActive.current(); }, [active]);
  return { scene, status, view, retry: () => retry(value => value + 1) };
}
