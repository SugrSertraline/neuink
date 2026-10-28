import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { readDailyState, saveDailyState } from '@/shared/ipc/dailyApi';
import type { DailySnapshot, DailyState } from '@/shared/types/daily';
import { formatLocalDate } from '@/modules/reader/components/libraryReading';
import { saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { RecommendationProvider } from './RecommendationContext';
import { DailyModelContext as Context, type DailyModel } from './dailyModel';
export { useDaily, type DailyModel } from './dailyModel';

/** App-wide data owner: a view closing never discards pending preference writes. */
export function DailyProvider({ root, openNote, openSource, children }: { root: string | null; openNote: DailyModel['openNote']; openSource?: DailyModel['openSource']; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<DailySnapshot | null>(null);
  const [draft, setDraft] = useState<DailyState | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const [today, setToday] = useState(() => formatLocalDate(new Date()));
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const dateRef = useRef({ today, chosenDate }); dateRef.current = { today, chosenDate };
  const [dateError, setDateError] = useState<string | null>(null);
  const current = useRef({ root, snapshot, draft, busy }); current.current = { root, snapshot, draft, busy };
  const generation = useRef(0);
  useEffect(() => {
    let pending = false, stopped = false;
    const tick = async () => {
      const next = formatLocalDate(new Date()), previous = dateRef.current;
      if (next === previous.today || pending) return;
      pending = true;
      const saved = previous.chosenDate !== null || await saveSegmentEditorsBeforeClose('daily-widgets');
      if (!stopped) {
        if (!saved && dateRef.current.chosenDate === null) { setChosenDate(previous.today); setDateError('已跨日，上一日草稿尚未保存；先处理保存提示，再切换到今天。'); }
        setToday(next);
      }
      pending = false;
    };
    const timer = window.setInterval(tick, 30_000); window.addEventListener('focus', tick);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  useEffect(() => {
    let cancelled = false; generation.current++; setSnapshot(null); setDraft(null); setError(null); setLoading(true); setBusy(false); setChosenDate(null);
    current.current = { root, snapshot: null, draft: null, busy: false };
    if (!root) { setLoading(false); return; }
    void readDailyState(root).then(async value => {
      if (cancelled) return;
      if (!cancelled) { current.current.snapshot = value; setSnapshot(value); }
    }).catch(caught => { if (!cancelled) setError(String(caught)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; generation.current++; };
  }, [root, attempt]);
  const write = useCallback(async (state: DailyState) => {
    const before = current.current, token = generation.current;
    if (!before.root || !before.snapshot || before.busy) return false;
    current.current = { ...before, busy: true, draft: state }; setDraft(state); setBusy(true); setError(null);
    try {
      const saved = await saveDailyState(before.root, before.snapshot, state);
      if (token !== generation.current) return false;
      current.current = { ...before, snapshot: saved, draft: null, busy: false }; setSnapshot(saved); setDraft(null); return true;
    } catch (caught) { if (token === generation.current) setError(String(caught)); return false; }
    finally { if (token === generation.current) { current.current.busy = false; setBusy(false); } }
  }, []);
  const mutate = useCallback((change: (state: DailyState) => DailyState) => {
    const before = current.current;
    if (!before.snapshot || before.draft || before.busy) return Promise.resolve(false);
    return write(change(structuredClone(before.snapshot.state)));
  }, [write]);
  const selectDate = async (date: string) => {
    const parsed = new Date(`${date}T12:00:00`);
    if (!await saveSegmentEditorsBeforeClose('daily-widgets')) { setDateError('当前草稿尚未保存，请先处理组件中的保存提示。'); return; }
    setDateError(null);
    if (!Number.isNaN(parsed.getTime()) && formatLocalDate(parsed) === date && date <= today) setChosenDate(date === today ? null : date);
  };
  return <Context.Provider value={{ root, state: draft ?? snapshot?.state ?? null, date: chosenDate ?? today, today, selectDate, loading, busy: busy || Boolean(draft), error: error ?? dateError, mutate,
    retry: () => { const pending = current.current.draft; if (pending) void write(pending); else setAttempt(n => n + 1); },
    reload: () => setAttempt(n => n + 1), openNote, openSource }}><RecommendationProvider key={root}>{children}</RecommendationProvider></Context.Provider>;
}
