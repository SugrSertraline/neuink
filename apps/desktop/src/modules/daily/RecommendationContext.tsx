import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { recommendationCommand } from '@/shared/ipc/dailyApi';
import type { ResearchPaper } from '@/shared/ipc/researchApi';
import { useDaily } from './dailyModel';

export type RecommendedPaper = ResearchPaper & { published: string; updated: string; categories: string[]; reasons: string[]; matched_interests: string[] };
export type RecommendationBatch = { date: string; generated_at: string; interests: string[]; interest_key: string; papers: RecommendedPaper[] };
export type Recommendations = { version: number; batches: RecommendationBatch[]; feedback: { id: string; ignored: boolean; saved: boolean }[]; last_attempt_at: string | null; last_error: string | null; retry_after?: string | null };
const hasDailyBatch = (state: Recommendations, date: string) => state.batches.some(batch => batch.date === date && (batch.papers.length > 0 || batch.interest_key?.startsWith('arxiv.py:')));
type Model = { state: Recommendations | null; busy: boolean; error: string | null; refresh: (generate?: boolean) => void; ensureToday: () => void; feedback: (id: string, ignored: boolean, saved: boolean) => void };
const Context = createContext<Model | null>(null);
export const useRecommendations = () => useContext(Context);

export function RecommendationProvider({ children }: { children: ReactNode }) {
  const daily = useDaily()!; const root = daily.root;
  const [state, setState] = useState<Recommendations | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const latest = useRef(root); latest.current = root; const alive = useRef(true);
  const pending = useRef(0), queue = useRef(Promise.resolve()), autoAttempt = useRef(''), readDate = useRef('');
  const call = useCallback(async (action: Record<string, unknown>) => {
    if (!root) return;
    pending.current++; setBusy(true);
    // Explicit refresh/save actions must wait for an ongoing read instead of silently disappearing.
    const request = queue.current.then(async () => {
      if (!alive.current || latest.current !== root) return;
      setError(null);
      try { const result = await recommendationCommand<Recommendations>(root, action); if (alive.current && latest.current === root) { setState(result); setError(result.last_error); } }
      catch (caught) { if (alive.current && latest.current === root) setError(String(caught)); }
    }).finally(() => { pending.current--; if (alive.current && latest.current === root) setBusy(pending.current > 0); });
    queue.current = request;
    await request;
  }, [root]);
  useEffect(() => { alive.current = true; setState(null); autoAttempt.current = ''; readDate.current = ''; return () => { alive.current = false; }; }, [call]);
  useEffect(() => {
    if (pending.current || readDate.current === daily.date) return;
    readDate.current = daily.date;
    void call({ kind: 'read', date: daily.date });
  }, [call, daily.date, busy]);
  const ensureToday = useCallback(() => {
    if (!state || !daily.state || pending.current) return;
    const identity = `${root}:${daily.today}`;
    // Reopening a completed local day is read-only, even if interests or reading records changed.
    // Legacy empty batches predate reliable retrieval; allow those one migration attempt.
    if (hasDailyBatch(state, daily.today) || autoAttempt.current === identity) return;
    autoAttempt.current = identity; void call({ kind: 'generate', date: daily.today, refresh: false });
  }, [state, daily.today, daily.state, root, call, busy]);
  useEffect(() => { ensureToday(); }, [ensureToday]);
  return <Context.Provider value={{ state, busy, error, ensureToday, refresh: generate => void call(generate ? { kind: 'generate', date: daily.today, refresh: true } : { kind: 'read', date: daily.date }), feedback: (id, ignored, saved) => void call({ kind: 'feedback', id, ignored, saved }) }}>{children}</Context.Provider>;
}
