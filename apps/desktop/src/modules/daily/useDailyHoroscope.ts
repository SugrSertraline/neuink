import { useEffect, useRef, useState } from 'react';
import { fetchDailyHoroscope, type DailyHoroscope } from './dailyHoroscopeApi';

type Cache = { date: string; status: 'interrupted' | 'ready' | 'error'; data?: DailyHoroscope };
type State = { identity: string; phase: 'idle' | 'loading' | 'ready' | 'error'; data?: DailyHoroscope };
const key = (zodiac: string) => `neuink.daily.horoscope.v1:${zodiac}`;

function read(zodiac: string, date: string): Cache | null {
  try {
    const raw = localStorage.getItem(key(zodiac));
    if (!raw || raw.length > 4_000) return null;
    const value = JSON.parse(raw) as Cache;
    if (value?.date !== date || !['interrupted', 'ready', 'error'].includes(value.status)) return null;
    if (value.status === 'ready' && (!value.data || !Object.values(value.data).every(item => typeof item === 'string' && item.length <= 360)
      || !value.data.summary || !value.data.work)) return null;
    return value;
  } catch { return null; }
}

export function useDailyHoroscope(active: boolean, date: string, zodiac: string) {
  const identity = `${date}:${zodiac}`;
  const [state, setState] = useState<State>({ identity: '', phase: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const manual = useRef(false);
  const memory = useRef(new Map<string, Cache>());
  useEffect(() => {
    if (!active || !zodiac) return;
    const force = manual.current; manual.current = false;
    const cached = memory.current.get(zodiac) ?? read(zodiac, date);
    if (!force && cached?.date === date) {
      setState({ identity, phase: cached.status === 'ready' ? 'ready' : 'error', data: cached.data });
      return;
    }
    const save = (value: Cache) => {
      memory.current.set(zodiac, value);
      try { localStorage.setItem(key(zodiac), JSON.stringify(value)); } catch { /* Keep the session copy. */ }
    };
    const controller = new AbortController();
    setState({ identity, phase: 'loading' });
    save({ date, status: 'interrupted' });
    void fetchDailyHoroscope(date, zodiac, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      save({ date, status: 'ready', data });
      setState({ identity, phase: 'ready', data });
    }).catch(() => {
      if (controller.signal.aborted) return;
      save({ date, status: 'error' });
      setState({ identity, phase: 'error' });
    });
    return () => controller.abort();
  }, [active, date, zodiac, attempt, identity]);
  return { ...(state.identity === identity ? state : { phase: 'idle' as const, data: undefined }),
    refresh: () => { manual.current = true; setAttempt(value => value + 1); } };
}
