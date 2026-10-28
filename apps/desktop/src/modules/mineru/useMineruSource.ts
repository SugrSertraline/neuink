import { open } from '@tauri-apps/plugin-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelMineruSearch, discoverMineru, getMineruSettings, onMineruSettingsChanged, saveMineruSettings, type MineruCandidate, type MineruSettings } from '@/shared/ipc/mineruApi';

let nextSearchId = 0;

export function useMineruSource(active: boolean, onSaved?: () => void) {
  const [settings, setSettings] = useState<MineruSettings | null>(null);
  const [candidates, setCandidates] = useState<MineruCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const pending = useRef(false);
  const search = useRef<string | null>(null);
  const latest = useRef<MineruSettings | null>(null);
  const saved = useRef(onSaved); saved.current = onSaved;
  const interruptSearch = useCallback(() => {
    const id = search.current;
    if (!id) return false;
    search.current = null;
    generation.current += 1;
    pending.current = false;
    setSearching(false);
    void cancelMineruSearch(id).catch(() => undefined);
    return true;
  }, []);
  const run = useCallback(async (action: (current: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    const id = ++generation.current;
    const current = () => generation.current === id;
    setBusy(true); setError(''); setNotice('');
    try { await action(current); }
    catch (caught) { if (current()) setError(typeof caught === 'string' ? caught : 'MinerU 目录操作失败，请重试。'); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }, []);
  const save = async (next: MineruSettings, current: () => boolean) => {
    const value = await saveMineruSettings(next);
    if (!current()) return;
    const changed = latest.current !== null && latest.current.results_directory !== value.results_directory;
    latest.current = value;
    setSettings(value);
    setCandidates([]);
    setNotice('结果目录已保存');
    if (changed) saved.current?.();
  };
  const find = async (current: () => boolean) => {
    const id = `mineru-${Date.now()}-${++nextSearchId}`;
    search.current = id;
    setSearching(true);
    let found: MineruCandidate[];
    try { found = await discoverMineru(id); }
    finally {
      if (search.current === id) { search.current = null; setSearching(false); }
    }
    if (!current()) return;
    if (found.length === 1) await save({ results_directory: found[0].results_directory }, current);
    else {
      setCandidates(found);
      setNotice(found.length ? '发现多个可能的结果目录，请选择一个。' : '常见位置未找到 MinerU 结果，请手动选择结果根目录。');
    }
  };
  const reload = useCallback(() => run(async current => {
    const value = await getMineruSettings();
    if (!current()) return;
    const changed = latest.current !== null && latest.current.results_directory !== value.results_directory;
    latest.current = value;
    setSettings(value);
    if (changed) saved.current?.();
    if (!value.results_directory) {
      await find(current);
    }
  }), [run]);
  useEffect(() => {
    if (active) void reload();
    return () => {
      const id = search.current;
      if (id) { search.current = null; void cancelMineruSearch(id).catch(() => undefined); }
      generation.current += 1; pending.current = false;
    };
  }, [active, reload]);
  useEffect(() => active ? onMineruSettingsChanged(() => {
    interruptSearch();
    void reload();
  }) : undefined, [active, reload, interruptSearch]);
  return {
    settings, candidates, busy, searching, error, notice, reload,
    choose: () => {
      const interrupted = interruptSearch();
      return run(async current => {
      const path = await open({ directory: true, multiple: false, title: '选择 MinerU 结果根目录' });
      if (typeof path === 'string' && current()) await save({ results_directory: path }, current);
      else if (interrupted && current()) setNotice('自动查找已停止。');
      });
    },
    detect: () => run(find),
    selectCandidate: (directory: string) => run(async current => {
      if (candidates.some(candidate => candidate.results_directory === directory)) await save({ results_directory: directory }, current);
    }),
  };
}
