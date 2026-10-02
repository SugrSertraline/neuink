import { useCallback, useEffect, useRef, useState } from 'react';
import { movePdfParseQueue, processPdfParseQueue, readPdfParseQueue, type ParseQueueMove, type PdfParseQueue } from '@/shared/ipc/pdfParseQueueApi';

const empty: PdfParseQueue = { waiting: [], active: [], failed: [] };

/** App owns scheduling; hiding the sidebar never stops it. Native metadata owns state/order. */
export function usePdfParseQueue(root: string | null, endpoint: string, apiKey: string | undefined,
  refreshKey: string, onChanged: () => Promise<unknown>) {
  const [state, setState] = useState({ root, queue: empty, error: '', loading: true });
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState({ root, message: '' });
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const currentRoot = useRef(root);
  currentRoot.current = root;
  const moveLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!root) { setState({ root, queue: empty, error: '', loading: false }); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let submitting = false;
    let fingerprint = '';
    const read = async () => {
      try {
        const queue = await readPdfParseQueue(root);
        if (disposed) return;
        const next = JSON.stringify(queue);
        setState({ root, queue, error: '', loading: false });
        if (fingerprint && fingerprint !== next) void Promise.resolve().then(() => {
          if (!disposed) return changed.current();
        }).catch(() => {});
        fingerprint = next;
        if (endpoint.trim() && !submitting && ((!queue.active.length && queue.waiting.length) || queue.active.some(e => !e.pdf?.parse.task_id))) {
          submitting = true;
          void processPdfParseQueue(root, endpoint, apiKey).then(async () => {
            if (!disposed) await changed.current();
          }).catch(error => {
            if (!disposed) setState(s => ({ ...s, error: String(error) }));
          }).finally(() => { submitting = false; });
        }
        // No idle polling, no overlapping snapshots, and one timer per mounted App.
        if (queue.waiting.length || queue.active.length || submitting) timer = setTimeout(read, 2000);
      } catch (error) {
        if (!disposed) setState(s => ({ root, queue: s.root === root ? s.queue : empty, loading: false, error: String(error) }));
      }
    };
    void read();
    return () => { disposed = true; clearTimeout(timer); };
  }, [root, endpoint, apiKey, refreshKey, revision]);

  const move = useCallback(async (id: string, movement: ParseQueueMove) => {
    if (!root || moveLock.current) return;
    moveLock.current = true; setBusy(true); setActionError({ root, message: '' });
    try {
      const queue = await movePdfParseQueue(root, id, movement);
      if (!mounted.current || currentRoot.current !== root) return;
      setState({ root, queue, error: '', loading: false });
      await changed.current();
    } catch (error) {
      if (mounted.current && currentRoot.current === root) setActionError({ root, message: String(error) });
    } finally {
      moveLock.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && currentRoot.current === root) setRevision(v => v + 1);
    }
  }, [root]);

  return { queue: state.root === root ? state.queue : empty,
    error: (actionError.root === root ? actionError.message : '') || (state.root === root ? state.error : ''),
    loading: state.root !== root || state.loading, busy, move,
    refresh: () => { setActionError({ root, message: '' }); setRevision(v => v + 1); }, configured: Boolean(endpoint.trim()) };
}
