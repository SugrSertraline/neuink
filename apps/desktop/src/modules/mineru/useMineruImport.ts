import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cancelMineruSearch, importMineruItem, scanMineru, type MineruImportResult, type MineruSnapshot } from '@/shared/ipc/mineruApi';
import { runLocalBackgroundJob } from '@/shared/lib/localBackgroundJobs';

import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

type ImportOutcome = { result?: MineruImportResult; error?: string };
let nextScanId = 0;

export function useMineruImport(root: string, onImported?: () => Promise<void> | void, scope = 'library') {
  const owner = useId();
  const [snapshot, setSnapshot] = useState<MineruSnapshot | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Record<string, ImportOutcome>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: '', stopped: false });
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef(false);
  const canceled = useRef(false);
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler(scope, owner, {
      isDirty: () => pending.current,
      save: async () => { if (pending.current) { setError('请先等待导入完成，或停止导入后再关闭。'); return false; } return true; },
      discard: () => { canceled.current = true; },
    });
    return () => { unregister(); setSegmentEditorDirty(scope, owner, false); };
  }, [scope, owner]);
  useEffect(() => { setSegmentEditorDirty(scope, owner, busy); }, [scope, owner, busy]);
  const scan = useRef<string | null>(null);
  const imported = useRef(onImported); imported.current = onImported;
  const cancelScan = useCallback(() => {
    const searchId = scan.current;
    scan.current = null;
    if (searchId) void cancelMineruSearch(searchId).catch(() => undefined);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; canceled.current = true; generation.current += 1; cancelScan(); };
  }, [root, cancelScan]);
  const reset = useCallback(() => {
    cancelScan();
    generation.current += 1;
    setSnapshot(null); setSelected(new Set()); setOutcomes({}); setError(''); setLoading(false);
    setProgress({ completed: 0, total: 0, current: '', stopped: false });
  }, [cancelScan]);
  const load = useCallback(async () => {
    if (pending.current) return;
    cancelScan();
    const id = ++generation.current;
    const searchId = `mineru-scan-${Date.now()}-${++nextScanId}`;
    scan.current = searchId;
    setLoading(true); setError(''); setSnapshot(null); setSelected(new Set()); setOutcomes({});
    setProgress({ completed: 0, total: 0, current: '', stopped: false });
    try {
      const next = await scanMineru(root, searchId);
      if (mounted.current && generation.current === id) setSnapshot(next);
    } catch (caught) {
      if (mounted.current && generation.current === id) setError(typeof caught === 'string' ? caught : '读取 MinerU 结果失败，请重试。');
    } finally {
      if (scan.current === searchId) scan.current = null;
      if (mounted.current && generation.current === id) setLoading(false);
    }
  }, [root, cancelScan]);
  const start = async () => {
    if (pending.current || !snapshot || !selected.size) return;
    const items = snapshot.items.filter(item => selected.has(item.id) && item.has_pdf && !outcomes[item.id]?.result);
    if (!items.length) return;
    pending.current = true; canceled.current = false; setBusy(true); setError('');
    setProgress({ completed: 0, total: items.length, current: '', stopped: false });
    try {
      await runLocalBackgroundJob({ kind: 'pdf_import', scope: { kind: 'workspace', root }, idPrefix: 'mineru-import', message: `正在导入 ${items.length} 项 MinerU 结果`, successMessage: 'MinerU 导入已完成', failureMessage: '部分 MinerU 结果未导入，请查看结果并重试' }, async report => {
        let failed = false;
        report({ current: 0, total: items.length, percent: 0 });
        for (const [index, item] of items.entries()) {
          if (canceled.current || !mounted.current) break;
          setProgress(previous => ({ ...previous, current: item.title }));
          let outcome: ImportOutcome;
          try {
            const result = await importMineruItem(root, snapshot.snapshot_id, item.id);
            outcome = { result };
            if (result.status === 'imported') {
              try { await imported.current?.(); }
              catch { setError('已导入论文，但列表刷新失败；关闭并重新打开条目库即可查看。'); }
            }
          } catch (caught) {
            failed = true;
            outcome = { error: typeof caught === 'string' ? caught : '导入失败，请重试。' };
          }
          report({ current: index + 1, total: items.length, percent: Math.round((index + 1) / items.length * 100) });
          if (!mounted.current) break;
          setOutcomes(previous => ({ ...previous, [item.id]: outcome }));
          if (outcome.result) setSelected(previous => { const next = new Set(previous); next.delete(item.id); return next; });
          setProgress(previous => ({ ...previous, completed: index + 1 }));
        }
        if (canceled.current || !mounted.current) throw new DOMException('Canceled', 'AbortError');
        if (failed) throw new Error('Some MinerU imports failed');
      });
    } catch {
      if (mounted.current && !canceled.current) setError('部分结果未导入，失败项仍保留选择，可直接重试。');
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setProgress(previous => ({ ...previous, current: '', stopped: canceled.current })); }
    }
  };
  return { snapshot, selected, setSelected, outcomes, loading, busy, error, progress, load, reset, start,
    cancel: () => { canceled.current = true; setProgress(previous => ({ ...previous, stopped: true })); } };
}
