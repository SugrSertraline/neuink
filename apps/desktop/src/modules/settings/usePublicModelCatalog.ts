import { useEffect, useRef, useState } from 'react';
import { loadPublicModelCatalog, readPublicModelCatalog } from '@/modules/assistant/sdk/modelCatalogStore';

export function usePublicModelCatalog(active: boolean) {
  const [catalog, setCatalog] = useState(readPublicModelCatalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const consumedAttempt = useRef(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); setBusy(true); setError('');
    const force = attempt !== consumedAttempt.current;
    consumedAttempt.current = attempt;
    void loadPublicModelCatalog(controller.signal, force).then(result => {
      if (!controller.signal.aborted) setCatalog(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('公开目录更新失败；已有数据和手动填写仍可用。');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, attempt]);
  return { catalog, busy, error, refresh: () => setAttempt(n => n + 1) };
}
