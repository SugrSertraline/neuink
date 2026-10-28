import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analyzeEntryTags, getLlmSettings, subscribeLlmSettings, type TagRecommendation } from '@/shared/ipc/assistantApi';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import { useReadingViewSession } from '../navigation/ReadingViewSession';
import { useReadingSession } from '../../parallel-reading/ReadingSessionContext';
import { beginTagSuggestionTask, pendingTagRecommendations, readTagSuggestions, subscribeTagSuggestions, tagSuggestionKey, updateTagSuggestions } from './entryTagSuggestionStore';

export function useEntryTagSuggestions({ entry, onApplyEntryTagPaths, workspaceRoot }: {
  entry: LibraryEntry; workspaceRoot: string | null;
  onApplyEntryTagPaths?: (entryId: string, paths: string[]) => Promise<unknown> | unknown;
}) {
  const { notify } = useToast();
  const view = useReadingViewSession();
  const session = useReadingSession();
  const active = view?.active ?? session?.active ?? true;
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<string | null | undefined>(undefined);
  const key = tagSuggestionKey(workspaceRoot, entry.id);
  const currentKey = useRef(key); currentKey.current = key;
  const live = useRef(true);
  const snapshot = useSyncExternalStore(subscribeTagSuggestions, () => readTagSuggestions(key));
  const recommendations = useMemo(() => pendingTagRecommendations(snapshot.recommendations, entry.tags), [snapshot.recommendations, entry.tags]);
  const selectedPaths = useMemo(() => new Set(recommendations.filter(tag => snapshot.selectedPaths.includes(tag.path)).map(tag => tag.path)), [recommendations, snapshot.selectedPaths]);
  const selectedRecommendations = recommendations.filter(tag => selectedPaths.has(tag.path));
  const disabledReason = !workspaceRoot ? '请先打开资料库。' : entry.status !== 'Parsed' ? 'PDF 解析完成后可以生成推荐标签。'
    : profile === undefined ? '正在读取模型设置…' : !profile ? '请先在设置中配置助手模型。' : null;
  useEffect(() => {
    live.current = true; let cancelled = false, updated = false;
    const applySettings = (settings: Awaited<ReturnType<typeof getLlmSettings>>) => {
      const model = settings.assistant_profile ?? settings.profiles.find(item => item.id === settings.assistant_profile_id);
      if (!cancelled) setProfile(model?.model.trim() && model.base_url.trim() ? model.id : null);
    };
    const unsubscribe = subscribeLlmSettings(settings => { updated = true; applySettings(settings); });
    void getLlmSettings().then(settings => { if (!updated) applySettings(settings); }).catch(() => { if (!cancelled && !updated) setProfile(null); });
    return () => { live.current = false; cancelled = true; unsubscribe(); };
  }, []);
  useEffect(() => { setOpen(false); }, [key]);

  const generate = useCallback(async () => {
    if (disabledReason) { updateTagSuggestions(key, { error: disabledReason }); return; }
    if (!workspaceRoot || !beginTagSuggestionTask(key, 'generating')) return;
    try {
      const response = await analyzeEntryTags({ entryId: entry.id, root: workspaceRoot, instruction: 'Suggest useful tags for this paper.' });
      const recommendations = [...new Map(response.recommendations.map(tag => [tag.path, tag])).values()];
      // A completed request belongs to its original entry, including after navigation/unmount.
      updateTagSuggestions(key, { recommendations, generatedAt: new Date().toISOString(),
        selectedPaths: recommendations.map(tag => tag.path) }, true);
    } catch (caught) { updateTagSuggestions(key, { error: `标签分析失败：${caught instanceof Error ? caught.message : String(caught)}` }); }
    finally { updateTagSuggestions(key, { phase: 'idle' }); }
  }, [disabledReason, entry.id, key, workspaceRoot]);
  useEffect(() => {
    if (!active || disabledReason) return;
    // Check the shared snapshot, not this render: split readers and StrictMode
    // must not start duplicate requests, including after a failed attempt.
    const current = readTagSuggestions(key);
    if (!current.decision && !current.generatedAt && !current.autoAttempted) void generate();
  }, [active, disabledReason, generate, key]);
  const toggleRecommendation = (tag: TagRecommendation) => {
    if (snapshot.phase !== 'idle' || !recommendations.some(item => item.path === tag.path)) return;
    const paths = new Set(readTagSuggestions(key).selectedPaths);
    if (paths.has(tag.path)) paths.delete(tag.path); else paths.add(tag.path);
    updateTagSuggestions(key, { selectedPaths: [...paths] }, true);
  };
  const apply = async () => {
    if (!selectedRecommendations.length || !workspaceRoot || !onApplyEntryTagPaths || !beginTagSuggestionTask(key, 'applying')) return;
    try {
      const paths = selectedRecommendations.map(tag => tag.path);
      await onApplyEntryTagPaths(entry.id, paths);
      const current = readTagSuggestions(key);
      updateTagSuggestions(key, { recommendations: pendingTagRecommendations(current.recommendations, paths),
        selectedPaths: current.selectedPaths.filter(path => !paths.includes(path)), decision: 'accepted' }, true);
      if (live.current && currentKey.current === key) {
        setOpen(false); notify({ tone: 'success', title: '推荐标签已保存', description: `已添加 ${paths.length} 个所选标签。` });
      }
    } catch (caught) { updateTagSuggestions(key, { error: `保存推荐标签失败：${caught instanceof Error ? caught.message : String(caught)}` }); }
    finally { updateTagSuggestions(key, { phase: 'idle' }); }
  };
  const discard = () => {
    if (readTagSuggestions(key).phase !== 'idle') return;
    // Retain the completion marker so reopening does not undo a dismissal.
    updateTagSuggestions(key, { recommendations: [], selectedPaths: [], error: null, decision: 'dismissed' }, true);
    setOpen(false);
  };
  return { apply, discard, generate, busy: snapshot.phase !== 'idle', phase: snapshot.phase, error: snapshot.error,
    showInReader: !snapshot.decision && !(snapshot.generatedAt && !recommendations.length && snapshot.phase === 'idle' && !snapshot.error),
    generatedAt: snapshot.generatedAt, disabledReason, canApply: selectedRecommendations.length > 0 && Boolean(workspaceRoot && onApplyEntryTagPaths),
    open, setOpen, recommendations, selectedPaths, toggleRecommendation };
}
