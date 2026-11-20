import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { importZoteroLocalCopy, importZoteroPaper, scanZotero, setZoteroPaperHidden, type ZoteroImportResult, type ZoteroSnapshot } from '@/shared/ipc/zoteroApi';
import { useConfirmPdfDuplicate } from '@/shared/lib/pdfDuplicate';
import { copySourceToLocal } from '@/shared/ipc/workspaceApi';
import { runLocalBackgroundJob } from '@/shared/lib/localBackgroundJobs';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

export type ImportOutcome = { result?: ZoteroImportResult; error?: string; cancelled?: boolean };
export function useZoteroImport(root: string, scope = 'library') {
  const confirmPdfDuplicate = useConfirmPdfDuplicate();
  const owner = useId();
  const [snapshot, setSnapshot] = useState<ZoteroSnapshot | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<Record<string, string | null>>({});
  const [outcomes, setOutcomes] = useState<Record<string, ImportOutcome>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hiding, setHiding] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: '', stopped: false });
  const mounted = useRef(true);
  const epoch = useRef(0);
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
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; canceled.current = true; epoch.current += 1; };
  }, [root]);
  const reset = useCallback(() => {
    epoch.current += 1; setSnapshot(null); setSelected(new Set()); setAttachments({}); setOutcomes({}); setError(''); setLoading(false);
    setProgress({ completed: 0, total: 0, current: '', stopped: false });
  }, []);
  const load = useCallback(async () => {
    if (pending.current) return;
    const id = ++epoch.current;
    setLoading(true); setError('');
    try {
      const next = await runLocalBackgroundJob({ kind: 'sync', scope: { kind: 'workspace', root }, idPrefix: 'zotero-read',
        message: '正在读取本地 Zotero 资料库', successMessage: 'Zotero 资料库读取完成', failureMessage: 'Zotero 读取失败，请在来源页面重试' }, async () => {
        const value = await scanZotero(root);
        if (!mounted.current || epoch.current !== id) throw new DOMException('读取已被替代', 'AbortError');
        return value;
      });
      if (!mounted.current || epoch.current !== id) return;
      setSnapshot(next);
      const ids = new Set(next.library.papers.map(p => p.id));
      const hidden = new Set(next.hidden);
      setSelected(previous => new Set([...previous].filter(id => ids.has(id) && !hidden.has(id))));
      setAttachments(previous => Object.fromEntries(next.library.papers.map(p => [p.id, previous[p.id] ?? p.attachments.find(a => a.available)?.key ?? null])));
    } catch (e) { if (mounted.current && epoch.current === id) setError(typeof e === 'string' ? e : '读取 Zotero 论文列表失败，请重试。'); }
    finally { if (mounted.current && epoch.current === id) setLoading(false); }
  }, [root]);
  const setHidden = async (paperId: string, hidden: boolean) => {
    if (!snapshot || busy || hiding) return;
    setHiding(paperId); setError('');
    try {
      await setZoteroPaperHidden(root, snapshot.snapshot_id, paperId, hidden);
      if (!mounted.current) return;
      setSnapshot(previous => previous && previous.snapshot_id === snapshot.snapshot_id ? {
        ...previous, hidden: hidden ? [...new Set([...previous.hidden, paperId])] : previous.hidden.filter(id => id !== paperId)
      } : previous);
      if (hidden) setSelected(previous => { const next = new Set(previous); next.delete(paperId); return next; });
    } catch (caught) { if (mounted.current) setError(typeof caught === 'string' ? caught : '保存隐藏状态失败，请重试。'); }
    finally { if (mounted.current) setHiding(null); }
  };
  const start = async () => {
    if (pending.current || !snapshot || !selected.size) return;
    pending.current = true; canceled.current = false; setBusy(true); setError('');
    const ids = [...selected].filter(id => !snapshot.hidden.includes(id) && !outcomes[id]?.result);
    const attachmentSelection = { ...attachments };
    const savedSnapshot = snapshot.snapshot_id;
    setProgress({ completed: 0, total: ids.length, current: '', stopped: false });
    try {
      await runLocalBackgroundJob({ kind: 'pdf_import', scope: { kind: 'workspace', root }, idPrefix: 'zotero-import', message: `正在导入 ${ids.length} 篇 Zotero 论文`, successMessage: 'Zotero 导入已完成', failureMessage: '部分 Zotero 论文未导入，请查看结果并重试' }, async report => {
        let failed = false;
        report({ current: 0, total: ids.length, percent: 0 });
        for (const [index, id] of ids.entries()) {
          if (canceled.current || !mounted.current) break;
          setProgress(p => ({ ...p, current: snapshot.library.papers.find(p => p.id === id)?.title ?? '' }));
          let outcome: ImportOutcome = {};
          try {
            const attachmentKey = attachmentSelection[id] ?? null;
            let forceNew = false;
            const paper = snapshot.library.papers.find(p => p.id === id);
            let result: ZoteroImportResult = snapshot.existing[id]
              ? { entry_id: snapshot.existing[id], title: paper?.title ?? '', status: 'skipped', has_pdf: Boolean(attachmentKey) }
              : await importZoteroPaper(root, savedSnapshot, id, attachmentKey);
            if (result.status === 'duplicate' && result.duplicate && confirmPdfDuplicate) {
              const sourcePath = paper?.attachments.find(a => a.key === attachmentKey)?.file_name ?? 'Zotero PDF';
              const confirmed = await confirmPdfDuplicate({ candidateTitle: paper?.title ?? result.title, sourcePath, duplicate: result.duplicate });
              if (confirmed && !canceled.current && mounted.current) { forceNew = true; result = await importZoteroPaper(root, savedSnapshot, id, attachmentKey, result.duplicate.contentHash); }
              else { outcome = { cancelled: true }; }
            } else if (result.status === 'duplicate') {
              outcome = { error: '该 PDF 与已有论文重复，请查看已有条目。' };
            }
            if (!outcome.error && !outcome.cancelled) {
              // Reading/indexing creates a managed source; this explicit action
              // alone publishes an independent local paper.
              const local = snapshot.existing[id]
                ? await importZoteroLocalCopy(root, result.entry_id)
                : await copySourceToLocal(root, result.entry_id, forceNew);
              outcome = { result: { ...result, entry_id: local.entry_id, status: local.created ? 'imported' : 'skipped' } };
            }
          }
          catch (e) { failed = true; outcome = { error: typeof e === 'string' ? e : '导入失败，请重试。' }; }
          report({ current: index + 1, total: ids.length, percent: Math.round((index + 1) / ids.length * 100) });
          if (!mounted.current) break;
          setOutcomes(previous => ({ ...previous, [id]: outcome }));
          if (outcome.result) setSelected(previous => { const next = new Set(previous); next.delete(id); return next; });
          setProgress(p => ({ ...p, completed: index + 1 }));
        }
        if (canceled.current || !mounted.current) throw new DOMException('Canceled', 'AbortError');
        if (failed) throw new Error('Some Zotero imports failed');
      });
    } catch {
      if (mounted.current && !canceled.current) setError('部分论文未导入，失败项已保留选择，可直接重试。');
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setProgress(p => ({ ...p, current: '', stopped: canceled.current })); }
    }
  };
  return { snapshot, selected, setSelected, attachments, setAttachments, outcomes, loading, busy, hiding, setHidden, error, progress, load, reset, start,
    cancel: () => { canceled.current = true; setProgress(p => ({ ...p, stopped: true })); } };
}
