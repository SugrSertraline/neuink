import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analyzeEntryTags, getLlmSettings, subscribeLlmSettings, type TagRecommendation } from '@/shared/ipc/assistantApi';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import { beginTagSuggestionTask, readTagSuggestions, subscribeTagSuggestions, tagSuggestionKey, updateTagSuggestions } from './entryTagSuggestionStore';

export function useEntryTagSuggestions({ entry, onApplyEntryTagPaths, workspaceRoot }: {
  entry: LibraryEntry; workspaceRoot: string | null;
  onApplyEntryTagPaths: (entryId: string, paths: string[]) => Promise<unknown> | unknown;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<string | null | undefined>(undefined);
  const key = tagSuggestionKey(workspaceRoot, entry.id);
  const currentKey = useRef(key); currentKey.current = key;
  const live = useRef(true);
  const snapshot = useSyncExternalStore(subscribeTagSuggestions, () => readTagSuggestions(key));
  const selectedPaths = useMemo(() => new Set(snapshot.selectedPaths), [snapshot.selectedPaths]);
  const appliedPaths = new Set(entry.tags);
  const selectedRecommendations = snapshot.recommendations.filter(tag => selectedPaths.has(tag.path) && !appliedPaths.has(tag.path));
  const disabledReason = !workspaceRoot ? '请先打开资料库。' : entry.status !== 'Parsed' ? 'PDF 解析完成后可以生成推荐标签。'
    : profile === undefined ? '正在读取模型设置…' : !profile ? '请先在设置中配置助手模型。' : null;
  useEffect(() => {
    live.current = true; let cancelled = false;
    const applySettings = (settings: Awaited<ReturnType<typeof getLlmSettings>>) => { if (!cancelled) setProfile(settings.assistant_profile_id); };
    const unsubscribe = subscribeLlmSettings(applySettings);
    void getLlmSettings().then(applySettings).catch(() => { if (!cancelled) setProfile(null); });
    return () => { live.current = false; cancelled = true; unsubscribe(); };
  }, []);
  useEffect(() => { setOpen(false); }, [key]);

  const generate = async () => {
    if (disabledReason) { updateTagSuggestions(key, { error: disabledReason }); return; }
    if (!workspaceRoot || !beginTagSuggestionTask(key, 'generating')) return;
    try {
      const response = await analyzeEntryTags({ entryId: entry.id, root: workspaceRoot, instruction: 'Suggest useful tags for this paper.' });
      const recommendations = [...new Map(response.recommendations.map(tag => [tag.path, tag])).values()];
      // A completed request belongs to its original entry, including after navigation/unmount.
      updateTagSuggestions(key, { recommendations, generatedAt: new Date().toISOString(),
        selectedPaths: recommendations.filter(tag => !appliedPaths.has(tag.path)).map(tag => tag.path) }, true);
    } catch (caught) { updateTagSuggestions(key, { error: `标签分析失败：${caught instanceof Error ? caught.message : String(caught)}` }); }
    finally { updateTagSuggestions(key, { phase: 'idle' }); }
  };
  const toggleRecommendation = (tag: TagRecommendation) => {
    if (snapshot.phase !== 'idle' || appliedPaths.has(tag.path)) return;
    const paths = new Set(readTagSuggestions(key).selectedPaths);
    if (paths.has(tag.path)) paths.delete(tag.path); else paths.add(tag.path);
    updateTagSuggestions(key, { selectedPaths: [...paths] }, true);
  };
  const apply = async () => {
    if (!selectedRecommendations.length || !workspaceRoot || !beginTagSuggestionTask(key, 'applying')) return;
    try {
      const paths = selectedRecommendations.map(tag => tag.path);
      await onApplyEntryTagPaths(entry.id, paths);
      updateTagSuggestions(key, { selectedPaths: readTagSuggestions(key).selectedPaths.filter(path => !paths.includes(path)) }, true);
      if (live.current && currentKey.current === key) {
        setOpen(false); notify({ tone: 'success', title: '推荐标签已添加', description: `已添加 ${paths.length} 个标签。` });
      }
    } catch (caught) { updateTagSuggestions(key, { error: `保存推荐标签失败：${caught instanceof Error ? caught.message : String(caught)}` }); }
    finally { updateTagSuggestions(key, { phase: 'idle' }); }
  };
  return { apply, generate, busy: snapshot.phase !== 'idle', phase: snapshot.phase, error: snapshot.error,
    generatedAt: snapshot.generatedAt, disabledReason, canApply: selectedRecommendations.length > 0 && Boolean(workspaceRoot),
    dismiss: () => setOpen(false), open, setOpen, recommendations: snapshot.recommendations, selectedPaths, toggleRecommendation };
}
