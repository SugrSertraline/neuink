import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { getLlmSettings, subscribeLlmSettings } from '@/shared/ipc/assistantApi';
import { listIdeationDrafts, saveIdeationDraft, type IdeationDraft, type IdeationDraftSummary, type IdeationState } from '@/shared/ipc/ideationApi';
import { workspaceStorageIdentity } from '@/shared/lib/workspaceStorageIdentity';
import { classifyCardError, generatePaperCards } from './generateCards';

/** Background output is stored as an independent draft and never changes user cards. */
export function useIdeationBackground(root: string, entries: LibraryEntry[], state: IdeationState | null, libraryReady: boolean, available = true) {
  const preferenceKey = `neuink.ideation.auto:${workspaceStorageIdentity(root)}`;
  const [enabled, setEnabledState] = useState(() => { try { return localStorage.getItem(preferenceKey) !== '0'; } catch { return true; } });
  const [summaries, setSummaries] = useState<IdeationDraftSummary[] | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelKnown, setModelKnown] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try { localStorage.setItem(preferenceKey, value ? '1' : '0'); } catch { setError('后台整理偏好保存失败，请检查本机存储。'); }
    if (!value) active.current?.abort();
  }, [preferenceKey]);
  const refresh = useCallback(async () => {
    try { const records = await listIdeationDrafts(root); if (mounted.current) { setSummaries(records); setError(null); } }
    catch { if (mounted.current) setError('读取后台整理记录失败，已暂停自动整理。'); }
  }, [root]);
  useEffect(() => {
    mounted.current = true;
    if (!available) { setSummaries([]); setModelKnown(true); return () => { mounted.current = false; }; }
    void refresh();
    let live = true, revision = 0;
    const publish = (settings: Awaited<ReturnType<typeof getLlmSettings>>) => { if (live) { setModelReady(Boolean(settings.assistant_profile)); setModelKnown(true); } };
    const unsubscribe = subscribeLlmSettings(settings => { revision++; publish(settings); });
    const observed = revision;
    void getLlmSettings().then(settings => { if (revision === observed) publish(settings); }).catch(() => { if (live) setModelKnown(true); });
    return () => { live = false; mounted.current = false; active.current?.abort(); unsubscribe(); };
  }, [available, refresh]);
  const byId = useMemo(() => new Map((summaries ?? []).map(item => [item.entry_id, item])), [summaries]);
  const pendingCount = entries.filter(entry => entry.status === 'Parsed' && !byId.has(entry.id)).length;
  useEffect(() => {
    if (!available || !enabled || !libraryReady || !modelReady || !state || !summaries || error || active.current) return;
    const retry = retryId ? entries.find(item => item.id === retryId && item.status === 'Parsed' && byId.get(item.id)?.status === 'failed') : undefined;
    // Legacy failures contained no diagnostic; retry them once with the updated
    // prompt and persist a classified result. New failures require user retry.
    const legacyFailure = entries.find(item => item.status === 'Parsed' && byId.get(item.id)?.status === 'failed' && !byId.get(item.id)?.error_code);
    const entry = retry ?? legacyFailure ?? entries.find(item => item.status === 'Parsed' && !byId.has(item.id));
    if (!entry) { if (retryId) setRetryId(null); return; }
    const controller = new AbortController(); active.current = controller; setActiveId(entry.id); setProgress(null);
    const expected = byId.get(entry.id)?.revision ?? 'missing';
    void (async () => {
      try {
        let draft: IdeationDraft;
        try {
          const result = await generatePaperCards(root, entry.id, controller.signal, (done, total) => { if (mounted.current && !controller.signal.aborted) setProgress({ done, total }); });
          draft = { entry_id: entry.id, status: 'ready', partial: result.partial, model: result.model,
            cards: result.cards.map(card => ({ id: card.id, entry_id: entry.id, title: card.title, body: card.body, kind: card.kind, sources: card.sources, pattern_ids: card.pattern_ids })), relations: result.relations ?? [] };
        } catch (caught) {
          if (controller.signal.aborted) return;
          // Store no provider error text: it may contain request details or secrets.
          draft = { entry_id: entry.id, status: 'failed', partial: false, model: '', cards: [], error_code: classifyCardError(caught) };
        }
        if (controller.signal.aborted) return;
        const saved = await saveIdeationDraft(root, expected, draft);
        if (!mounted.current || !saved.draft) return;
        const item: IdeationDraftSummary = { entry_id: entry.id, status: saved.draft.status, count: saved.draft.cards.length, partial: saved.draft.partial, revision: saved.revision,
          card_ids: saved.draft.cards.map(card => card.id), cards: saved.draft.cards.map(card => ({ id: card.id, kind: card.kind, title: card.title, body: Array.from(card.body).slice(0, 280).join(''), pattern_ids: card.pattern_ids })), error_code: saved.draft.error_code };
        setSummaries(current => [...(current ?? []).filter(row => row.entry_id !== item.entry_id), item]);
      } catch {
        if (mounted.current && !controller.signal.aborted) setError('后台结果保存失败或记录已更新，自动整理已暂停，请刷新后重试。');
      } finally {
        if (active.current === controller) { active.current = null; if (mounted.current) { setActiveId(null); setRetryId(null); } }
      }
    })();
  }, [available, enabled, libraryReady, modelReady, state, summaries, error, entries, byId, retryId, root, activeId]);
  const retry = useCallback((entryId: string) => { setError(null); setEnabled(true); setRetryId(entryId); }, [setEnabled]);
  return { progress, enabled, setEnabled, summaries, byId, activeId, error, refresh, retry, pendingCount, modelReady, modelKnown };
}
