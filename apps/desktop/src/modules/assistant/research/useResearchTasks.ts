import { useCallback, useEffect, useRef, useState } from 'react';
import { deepResearchCommand, type ResearchStatus, type ResearchTask, type ResearchTaskSummary } from '@/shared/ipc/deepResearchApi';

export type ResearchModel = ReturnType<typeof useResearchTasks>;

/** Rust owns processes. Polling only observes and never submits work on mount/reconnect. */
export function useResearchTasks(root: string | null) {
  const [status, setStatus] = useState<ResearchStatus | null>(null), [tasks, setTasks] = useState<ResearchTaskSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null), [task, setTask] = useState<ResearchTask | null>(null);
  const [thread, setThread] = useState<ResearchTask[]>([]);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const current = useRef({ root, selected, alive: true, busy: false, generation: 0 }); current.current.root = root; current.current.selected = selected;
  const refresh = useCallback(async () => {
    if (!root) { setLoading(false); return; }
    const token = current.current.generation;
    const valid = () => current.current.alive && current.current.root === root && current.current.generation === token;
    try {
      const [nextStatus, nextTasks] = await Promise.all([deepResearchCommand<ResearchStatus>(root, { kind: 'status' }), deepResearchCommand<ResearchTaskSummary[]>(root, { kind: 'list' })]);
      if (!valid()) return;
      setStatus(nextStatus); setTasks(nextTasks); setReadError(null);
      const id = current.current.selected;
      if (id) {
        const next = await deepResearchCommand<ResearchTask>(root, { kind: 'get', id });
        if (valid() && current.current.selected === id) {
          setTask(next);
          const messages = next.parent_id ? await deepResearchCommand<ResearchTask[]>(root, { kind: 'thread', id }) : [next];
          if (valid() && current.current.selected === id) setThread(messages.map(message => message.id === next.id ? next : message));
        }
      }
    } catch (caught) { if (valid()) setReadError(String(caught)); }
    finally { if (valid()) setLoading(false); }
  }, [root]);
  useEffect(() => {
    current.current.generation++; current.current.alive = true; current.current.busy = false; setBusy(false); setStatus(null); setTasks([]); setSelected(null); setTask(null); setThread([]); setError(null); setReadError(null); setLoading(true);
    let polling = false;
    const poll = async () => { if (polling) return; polling = true; try { await refresh(); } finally { polling = false; } };
    void poll(); const timer = window.setInterval(() => void poll(), 3000);
    return () => { current.current.alive = false; current.current.generation++; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { setTask(null); setThread([]); if (selected) void refresh(); }, [selected, refresh]);
  const command = async <T,>(action: Record<string, unknown>): Promise<T | null> => {
    if (!root || current.current.busy) return null;
    const token = current.current.generation;
    const valid = () => current.current.alive && current.current.root === root && current.current.generation === token;
    current.current.busy = true; setBusy(true); setError(null);
    try { const value = await deepResearchCommand<T>(root, action); if (!valid()) return null; await refresh(); return value; }
    catch (caught) { if (valid()) setError(String(caught)); return null; }
    finally { if (valid()) { current.current.busy = false; setBusy(false); } }
  };
  return { status, tasks, selected, task, thread, error: error ?? readError, busy, loading, command, refresh: () => { setError(null); return refresh(); }, select: setSelected };
}
