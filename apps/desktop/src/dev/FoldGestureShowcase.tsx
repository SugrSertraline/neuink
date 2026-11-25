import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Bookmark, ListRestart } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import type { SourceSegment } from '@/shared/types/domain';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import { DEFAULT_REFLOW_COMPONENT_PREFERENCES, readStoredReaderPreferences, type ReflowOriginalDisplay } from '@/shared/lib/readerPreferences';
import { ReflowSegmentGroupView } from '@/modules/reader/components/reflow/ReflowSegmentGroupView';
import { ReflowToolbar } from '@/modules/reader/components/reflow/ReflowToolbar';
import { ReflowAppearanceControls } from '@/modules/reader/components/reflow/ReflowAppearanceControls';
import { ReflowComponentControls } from '@/modules/reader/components/reflow/ReflowComponentControls';
import { HoverPreviewControls } from '@/modules/reader/components/pdf-reader/ReaderToolbar';
import { ReflowLanguageControls } from '@/modules/reader/components/reflow/ReflowLanguageControls';
import { ReflowComponentPreferencesProvider } from '@/modules/reader/components/reflow/ReflowComponentPreferencesContext';
import { buildReflowSegmentGroups } from '@/modules/reader/components/reflow/buildReflowBlocks';
import { FoldReaderProvider } from '@/modules/reader/folding/FoldReaderContext';
import type { FoldLevel, FoldReader } from '@/modules/reader/folding/useFoldReader';
import { FOLD_GESTURE_HINT } from '@/modules/reader/folding/useFoldLevelGesture';
import { FoldControls } from '@/modules/reader/folding/FoldControls';
import { FoldTaskDialog } from '@/modules/reader/folding/FoldTaskDialog';
import { effectiveFoldOriginal, foldLevelAfterOriginalChange } from '@/modules/reader/folding/foldDisplay';
import { foldViewsForSource } from '@/modules/reader/folding/foldViews';
import '@/styles/globals.css';

// Synthetic cached results only: this page never starts generation or reads a workspace.
const sentences = [
  'This synthetic experiment compares two scheduling methods in a fictional factory.',
  'The adaptive method reduces average waiting time from twenty minutes to fifteen minutes.',
  'Both methods process the same number of tasks and use the same machine capacity.',
  'The improvement appears only when the simulated workload changes over time.',
  'These illustrative results do not establish performance in a real manufacturing environment and require further validation with operational data.'
];
const segments: SourceSegment[] = [0, 1, 2].map(index => ({ uid: `gesture-${index}`, segment_type: 'paragraph', page_idx: index,
  bbox: null, markdown: null, text: sentences.join(' ') }));
const records: Record<string, FoldRecord> = Object.fromEntries(segments.slice(0, 2).map(segment => [segment.uid, {
  segment_uid: segment.uid, source: segment.text, evidence: [1, 3], brief: [sentences[1], sentences[3]],
  key: 'The adaptive method reduces waiting time. The improvement appears only with changing workloads.',
  takeaway: 'The adaptive method reduces waiting time in a simulated factory.', topic: 'waiting time', model: 'synthetic', generated_at: ''
}]));
const translations = {
  full: '模拟实验比较了同一虚构工厂中的两种调度方法。自适应方法把平均等待时间从二十分钟降低到十五分钟。两种方法处理相同数量的任务，并使用相同的机器容量。改善仅在模拟工作负载随时间变化时出现。这些合成数据不能证明真实制造现场的性能，还需要实际环境中的验证。',
  brief: '自适应方法把平均等待时间从二十分钟降低到十五分钟。改善仅在模拟工作负载随时间变化时出现。',
  key: '自适应方法缩短等待时间。改善仅在工作负载变化时出现。',
  takeaway: '自适应方法缩短模拟工厂的等待时间。', topic: '等待时间'
};
for (const record of Object.values(records)) {
  const views = foldViewsForSource(record, record.source)!;
  record.translations = Object.fromEntries((['brief', 'key', 'takeaway', 'topic'] as const).map(level => [level, {
    source_text: views[level].text, translated_text: translations[level], model: 'synthetic', generated_at: ''
  }]));
}
const translatedSegments = new Map<string, TranslatedSegment>(segments.map(segment => [segment.uid, {
  segment_uid: segment.uid, page_idx: segment.page_idx, segment_type: segment.segment_type, source_hash: 'synthetic',
  source_text: segment.text, translated_text: translations.full, status: 'translated', error: null, updated_at: ''
}]));
const groups = buildReflowSegmentGroups(segments);
const noop = () => {};

function FoldGestureShowcase() {
  const [level, setLevel] = useState<FoldLevel>('full');
  const [overrides, setOverrides] = useState<Record<string, FoldLevel>>({});
  const [navigation, setNavigation] = useState(0);
  const [original, setOriginal] = useState<ReflowOriginalDisplay>('original');
  const [translation, setTranslation] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [readerPreferences, setReaderPreferences] = useState(readStoredReaderPreferences);
  const [translationBusy, setTranslationBusy] = useState(false);
  const fold: FoldReader = { root: null, entryId: 'gesture-preview', title: '段落详略快捷操作', segments, ready: true,
    level, setLevel, overrides, records, loadState: 'ready', running: false, task: null, error: null,
    reload: async () => {}, start: () => false, cancel: noop, pause: noop, resume: noop, cancelSegments: noop,
    setOverride: (uid, value) => setOverrides(current => {
      const next = { ...current }; if (value === 'inherit') delete next[uid]; else next[uid] = value; return next;
    }) };
  return <TooltipProvider><ToastContext.Provider value={{ notify: () => 'preview', dismiss: noop }}>
    <main className="flex h-screen flex-col bg-background text-foreground">
      <ReflowToolbar compact={false} busy={translationBusy} entryTitle="Synthetic manufacturing experiment: Adaptive scheduling and waiting-time comparison under changing workloads · 阅读详略与语言显示演示"
        navigation={<><Button size="icon-sm" variant="ghost" aria-label="后退" disabled><ArrowLeft /></Button><Button size="icon-sm" variant="ghost" aria-label="前进" disabled><ArrowRight /></Button><Button size="icon-sm" variant="ghost" aria-label="书签"><Bookmark /></Button></>}
        appearance={<ReflowAppearanceControls preferences={readerPreferences} onChange={setReaderPreferences} />}
        primaryTools={<FoldControls fold={fold} onLevelChange={setLevel} onShowProgress={() => setTaskOpen(true)} />}
        translationMode={<ReflowLanguageControls original={effectiveFoldOriginal(level, original)} translation={translation}
          onOriginalChange={value => { setLevel(foldLevelAfterOriginalChange(level, value)); setOriginal(value); }} onTranslationChange={setTranslation} />}>
        {level !== 'off' && original === 'sentences' ? <span className="text-xs text-muted-foreground">详略阅读期间暂停逐句对照</span> : null}
        <ReflowComponentControls preferences={readerPreferences} onChange={setReaderPreferences} />
        <HoverPreviewControls mode="reflow" preferences={readerPreferences} onChange={setReaderPreferences} />
        {translationBusy ? <Button size="sm" variant="outline" onClick={() => setTranslationBusy(false)}>暂停</Button> : null}
        {translationBusy ? <Button size="sm" variant="outline" onClick={() => setTranslationBusy(false)}>取消翻译</Button> : null}
        <Button size="sm" variant="outline">导出</Button>
        <Button size="sm" variant={translationBusy ? 'secondary' : 'outline'} onClick={() => setTranslationBusy(value => !value)}>{translationBusy ? '翻译任务进行中' : '翻译任务'}</Button>
        <Button size="sm" variant="outline" disabled><ListRestart size={14} />隐藏列表</Button>
      </ReflowToolbar>
      <div className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
        <p>{FOLD_GESTURE_HINT}</p>
        <p className="mt-1">合成数据：前两段已有详略，第三段尚未生成；不会调用模型。段落导航次数：{navigation}</p>
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="outline" onClick={() => { setLevel('full'); setOverrides({}); setOriginal('original'); setTranslation(false); setTranslationBusy(false); }}>重置阅读</Button>
          <Button size="xs" variant="outline" onClick={() => setTranslationBusy(value => !value)}>切换任务状态</Button>
          <Button size="xs" variant="outline" onClick={() => { document.documentElement.style.zoom = document.documentElement.style.zoom === '1.5' ? '1' : '1.5'; }}>切换 150% 界面缩放</Button>
        </div>
      </div>
      <div className="reflow-document-scroll min-h-0 flex-1 overflow-y-auto px-8">
        <ReflowComponentPreferencesProvider value={{ ...DEFAULT_REFLOW_COMPONENT_PREFERENCES, content: { paragraph: {
          parsed: original !== 'hidden', translation, translationView: original === 'sentences' ? 'sentences' : 'paragraph'
        } } }}>
        <FoldReaderProvider value={fold}>{groups.map(group => <ReflowSegmentGroupView key={group.id}
          active={false} flashed={false} entryId="gesture-preview" workspaceRoot={null} hoverPreviewEnabled={false}
          pdfDocument={null} reflowTranslationMode="source" segmentGroup={group}
          annotationsBySegmentUid={new Map()} notesBySegmentUid={new Map()} translationBySegmentUid={translatedSegments}
          sourceLinkCountBySegmentUid={new Map()} sourceBacklinksBySegmentUid={{}}
          onActivateSegment={() => setNavigation(value => value + 1)} onOpenSegmentAnnotation={noop} onOpenSegmentNote={noop}
          onPreviewChange={noop} onRequirePdfDocument={noop} onHideSegment={noop} onCopyContent={noop}
          onCopySourceLink={noop} onOpenSourceBacklink={noop} />)}</FoldReaderProvider>
        </ReflowComponentPreferencesProvider>
      </div>
      <FoldTaskDialog open={taskOpen} onOpenChange={setTaskOpen} fold={fold} />
    </main>
  </ToastContext.Provider></TooltipProvider>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<FoldGestureShowcase />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
