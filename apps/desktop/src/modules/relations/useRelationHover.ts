import { useCallback, useEffect, useRef, useState } from 'react';

/** Canvas raycasting must not clear a label's pointer/focus ownership. */
export function useRelationHover() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const sources = useRef({ canvas: null as string | null, label: null as string | null, focus: null as string | null });
  const publish = useCallback(() => {
    const { canvas, label, focus } = sources.current;
    setHoveredId(label ?? canvas ?? focus);
  }, []);
  const setCanvas = useCallback((id: string | null) => {
    if (sources.current.label) return;
    sources.current.canvas = id; publish();
  }, [publish]);
  const setLabel = useCallback((id: string | null) => {
    sources.current.canvas = null; sources.current.label = id; publish();
  }, [publish]);
  const setFocus = useCallback((id: string | null) => { sources.current.focus = id; publish(); }, [publish]);
  const clear = useCallback(() => {
    sources.current = { canvas: null, label: null, focus: null }; publish();
  }, [publish]);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'hidden') clear(); };
    window.addEventListener('blur', clear); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); };
  }, [clear]);
  return { hoveredId, setCanvas, setLabel, setFocus, clear };
}
