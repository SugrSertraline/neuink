import { useEffect, useState } from 'react';
import { runLocalBackgroundJob, type LocalJobReporter } from '@/shared/lib/localBackgroundJobs';
import { getZoteroSettings, importZoteroPaper, onZoteroSettingsChanged, scanZotero } from '@/shared/ipc/zoteroApi';
import { getMineruSettings, importMineruItem, onMineruSettingsChanged, scanMineru } from '@/shared/ipc/mineruApi';

export type LibrarySourceSync = {
  root: string | null;
  enabledSources?: { zotero: boolean; mineru: boolean };
  running: boolean;
  current: string;
  completed: number;
  total: number;
  imported: number;
  unresolved: number;
  changedEntryIds: string[];
  changes: LibrarySourceChange[];
  issues: LibrarySourceIssue[];
  scanVersion: number;
  truncated: boolean;
  error: string | null;
  refresh: () => void;
  review?: () => void;
  acknowledge: (change: LibrarySourceChange) => void;
};

export type LibrarySourceChange = {
  source: 'zotero' | 'mineru'; entryId: string; sourceId: string; fingerprint: string; sourceTitle: string;
  sourceFields?: Record<string, string>; sourceTags?: string[]; sourcePdfName?: string | null;
  sourcePath?: string;
};
export type LibrarySourceIssue = { source: 'zotero' | 'mineru'; title: string; reason: string; entryId?: string };

const initial = { root: null as string | null, enabledSources: { zotero: false, mineru: false }, running: false, current: '', completed: 0, total: 0, imported: 0, unresolved: 0, changedEntryIds: [] as string[], changes: [] as LibrarySourceChange[], issues: [] as LibrarySourceIssue[], scanVersion: 0, truncated: false, error: null };
const reviewKey = (root: string, change: LibrarySourceChange) => `neuink.sourceReview.v1:${root}:${change.source}:${change.sourceId}`;
const isAcknowledged = (root: string, change: LibrarySourceChange) => {
  try { return Boolean(change.fingerprint) && window.localStorage.getItem(reviewKey(root, change)) === change.fingerprint; }
  catch { return false; }
};

export function useLibrarySourceSync(root: string | null, ready: boolean, onEntriesImported: () => Promise<void>) {
  const [state, setState] = useState<Omit<LibrarySourceSync, 'refresh' | 'acknowledge' | 'review'>>(initial);
  const [refreshId, setRefreshId] = useState(0);
  useEffect(() => {
    if (!root || !ready) { setState(initial); return; }
    let cancelled = false;
    let running = false;
    let requested = false;
    let lastRunAt = 0;
    const runOnce = async (report: LocalJobReporter) => {
      const [zoteroSettings, mineruSettings] = await Promise.all([getZoteroSettings(), getMineruSettings()]);
      if (cancelled) throw new DOMException('已停止来源检查', 'AbortError');
      const enabledSources = { zotero: zoteroSettings.enabled !== false, mineru: mineruSettings.enabled !== false };
      setState(previous => ({ ...previous, enabledSources }));
      let imported = 0;
      let unresolved = 0;
      let completed = 0;
      let total = 0;
      let changedEntryIds: string[] = [];
      let changes: LibrarySourceChange[] = [];
      let issues: LibrarySourceIssue[] = [];
      let truncated = false;
      let entriesChanged = false;
      let error: string | null = null;
      const update = (current: string) => {
        if (cancelled) return;
        report({ current: completed, total, percent: total ? Math.min(100, completed / total * 100) : 0 }, { message: current });
        setState(previous => ({ ...previous, running: true, current, completed, total, imported, unresolved, changedEntryIds, changes, issues, truncated, error }));
      };
      if (enabledSources.zotero && zoteroSettings.data_directory) {
        try {
          update('正在检查 Zotero');
          const snapshot = await scanZotero(root);
          if (snapshot.organization_updated) entriesChanged = true;
          const currentPaperIds = new Set(snapshot.library.papers.map(paper => paper.id));
          for (const [paperId, entryId] of Object.entries(snapshot.existing)) {
            if (!currentPaperIds.has(paperId)) issues.push({ source: 'zotero', title: paperId, entryId, reason: '来源论文已不在当前 Zotero 资料库；已保存的来源缓存仍保留。' });
          }
          const changedIds = new Set(snapshot.changed ?? []);
          changes = changes.concat(snapshot.library.papers.filter(paper => changedIds.has(paper.id) && snapshot.existing[paper.id]).map(paper => ({
            source: 'zotero' as const, entryId: snapshot.existing[paper.id], sourceId: paper.id, fingerprint: snapshot.fingerprints?.[paper.id] ?? '', sourceTitle: paper.title,
            sourceFields: paper.fields, sourceTags: paper.tags,
            sourcePdfName: paper.attachments.find(file => file.available)?.file_name ?? null,
          })).filter(change => !isAcknowledged(root, change)));
          changedEntryIds = changes.map(change => change.entryId);
          const candidates = snapshot.library.papers.filter(paper => !snapshot.existing[paper.id]);
          total += candidates.length;
          update('正在更新 Zotero 来源缓存');
          for (const paper of candidates) {
            if (cancelled) break;
            try {
              const attachment = paper.attachments.find(file => file.available);
              const result = await importZoteroPaper(root, snapshot.snapshot_id, paper.id, attachment?.key ?? null, undefined, true);
              if (result.status === 'imported') { imported += 1; entriesChanged = true; }
              else if (result.status === 'skipped') entriesChanged = true;
              else if (result.status === 'duplicate') { unresolved += 1; issues.push({ source: 'zotero', title: paper.title, reason: 'PDF 内容与现有论文重复，需要手动决定是否再添加。' }); }
            } catch (caught) { unresolved += 1; issues.push({ source: 'zotero', title: paper.title, reason: String(caught) }); }
            completed += 1;
            update(`Zotero · ${paper.title}`);
          }
        } catch (caught) { error = `Zotero 扫描失败：${String(caught)}`; }
        if (entriesChanged && !cancelled) { await onEntriesImported(); entriesChanged = false; }
      }
      if (!cancelled && enabledSources.mineru && mineruSettings.results_directory) {
        try {
          update('正在检查 MinerU');
          const snapshot = await scanMineru(root, `library-sync-${Date.now()}`, true);
          const currentItemIds = new Set(snapshot.items.map(item => item.id));
          if (!snapshot.truncated) for (const [itemId, entryId] of Object.entries(snapshot.existing ?? {})) {
            if (!currentItemIds.has(itemId)) issues.push({ source: 'mineru', title: itemId, entryId, reason: '来源结果已不在当前 MinerU 目录；已保存的来源缓存仍保留。' });
          }
          const changedIds = new Set(snapshot.changed ?? []);
          changes = changes.concat(snapshot.items.filter(item => changedIds.has(item.id) && snapshot.existing?.[item.id]).map(item => ({
            source: 'mineru' as const, entryId: snapshot.existing![item.id], sourceId: item.id, fingerprint: snapshot.fingerprints?.[item.id] ?? '', sourceTitle: item.title, sourcePath: item.path,
          })).filter(change => !isAcknowledged(root, change)));
          changedEntryIds = changes.map(change => change.entryId);
          truncated = snapshot.truncated;
          for (const item of snapshot.items.filter(item => !item.has_pdf && !snapshot.existing?.[item.id])) {
            unresolved += 1; issues.push({ source: 'mineru', title: item.title, reason: '解析结果缺少原 PDF，无法自动创建条目。' });
          }
          const candidates = snapshot.items.filter(item => item.has_pdf && !snapshot.existing?.[item.id]);
          total += candidates.length;
          update('正在同步 MinerU');
          for (const item of candidates) {
            if (cancelled) break;
            try {
              const result = await importMineruItem(root, snapshot.snapshot_id, item.id);
              if (result.status === 'imported') imported += 1;
              entriesChanged = true;
            } catch (caught) { unresolved += 1; issues.push({ source: 'mineru', title: item.title, reason: String(caught) }); }
            completed += 1;
            update(`MinerU · ${item.title}`);
          }
        } catch (caught) { error = [error, `MinerU 扫描失败：${String(caught)}`].filter(Boolean).join('；'); }
      }
      if (entriesChanged && !cancelled) await onEntriesImported();
      if (!cancelled && !requested) setState(previous => {
        const pending = changes.filter(change => !isAcknowledged(root, change));
        return { root, enabledSources, running: false, current: '', completed, total, imported, unresolved, changedEntryIds: [...new Set(pending.map(change => change.entryId))], changes: pending, issues, scanVersion: previous.scanVersion + 1, truncated, error };
      });
      if (cancelled) throw new DOMException('已停止来源检查', 'AbortError');
      if (error || unresolved || truncated) throw new Error(error || '部分来源需要处理，请查看来源动态');
    };
    const run = async () => {
      if (running) { requested = true; return; }
      running = true;
      do {
        requested = false;
        lastRunAt = Date.now();
        setState(previous => ({ ...(previous.root === root ? previous : initial), root, running: true, current: '正在检查来源', completed: 0, total: 0, imported: 0, unresolved: 0, changedEntryIds: [], changes: [], issues: [], truncated: false, error: null }));
        try { await runLocalBackgroundJob({ kind: 'sync', scope: { kind: 'workspace', root }, idPrefix: 'library-source-sync',
          message: '正在读取本地来源配置', successMessage: '本地来源缓存检查完成', failureMessage: '来源同步有待处理内容，请查看来源动态' }, runOnce); }
        catch (caught) { if (!cancelled) setState(previous => ({ ...previous, running: false, current: '', error: `来源检查失败：${String(caught)}` })); }
      } while (requested && !cancelled);
      running = false;
    };
    const onFocus = () => { if (!cancelled && document.visibilityState !== 'hidden' && Date.now() - lastRunAt >= 2 * 60_000) void run(); };
    const stopZotero = onZoteroSettingsChanged(() => {
      void getZoteroSettings().then(settings => {
        if (!cancelled) setState(previous => {
          const zotero = settings.enabled !== false;
          const changes = zotero ? previous.changes : previous.changes.filter(change => change.source !== 'zotero');
          return { ...previous, enabledSources: { zotero, mineru: previous.enabledSources?.mineru ?? false },
            changes, issues: zotero ? previous.issues : previous.issues.filter(issue => issue.source !== 'zotero'),
            changedEntryIds: [...new Set(changes.map(change => change.entryId))] };
        });
      }).catch(() => undefined);
      void run();
    });
    const stopMineru = onMineruSettingsChanged(() => {
      void getMineruSettings().then(settings => {
        if (!cancelled) setState(previous => {
          const mineru = settings.enabled !== false;
          const changes = mineru ? previous.changes : previous.changes.filter(change => change.source !== 'mineru');
          return { ...previous, enabledSources: { zotero: previous.enabledSources?.zotero ?? false, mineru },
            changes, issues: mineru ? previous.issues : previous.issues.filter(issue => issue.source !== 'mineru'),
            changedEntryIds: [...new Set(changes.map(change => change.entryId))] };
        });
      }).catch(() => undefined);
      void run();
    });
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    void run();
    return () => { cancelled = true; stopZotero(); stopMineru(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [root, ready, refreshId, onEntriesImported]);
  const acknowledge = (change: LibrarySourceChange) => {
    if (!root || !change.fingerprint) return;
    window.localStorage.setItem(reviewKey(root, change), change.fingerprint);
    setState(previous => {
      const changes = previous.changes.filter(item => !(item.source === change.source && item.sourceId === change.sourceId));
      return { ...previous, changes, changedEntryIds: changes.map(item => item.entryId) };
    });
  };
  return { ...state, refresh: () => setRefreshId(value => value + 1), acknowledge } satisfies LibrarySourceSync;
}
