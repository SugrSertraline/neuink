import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { emit } from '@tauri-apps/api/event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import { ParagraphTranslationProvider } from '@/modules/reader/components/reflow/ParagraphTranslationContext';
import { ReflowSegmentGroupView } from '@/modules/reader/components/reflow/ReflowSegmentGroupView';
import { ReflowSegmentPreferencesProvider } from '@/modules/reader/components/reflow/ReflowSegmentPreferences';
import { ReflowComponentPreferencesProvider } from '@/modules/reader/components/reflow/ReflowComponentPreferencesContext';
import { ReflowComponentControls } from '@/modules/reader/components/reflow/ReflowComponentControls';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { buildReflowSegmentGroups } from '@/modules/reader/components/reflow/buildReflowBlocks';
import type { SourceSegment } from '@/shared/types/domain';
import type { ParagraphTranslation, ParagraphView, ParagraphLiveProgress } from '@/shared/ipc/paragraphTranslationApi';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import '../styles/globals.css';

const noop = () => undefined;
const previewToast = { dismiss: noop, notify: () => 'preview' };
const source = 'Dr. Lee measured a 3.5% improvement in accuracy [1]. The results suggest that the model can preserve evidence across multiple stages.';
const segment: SourceSegment = { uid: 'preview-paragraph', segment_type: 'paragraph', page_idx: 0, bbox: null, markdown: null, text: source };
const sampleImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="140"><rect width="560" height="140" fill="white"/><rect x="30" y="40" width="130" height="60" rx="4" fill="#e8edf4" stroke="#34435c"/><text x="65" y="76" font-size="20">Source</text><path d="M160 70H350" stroke="#34435c" stroke-width="2"/><rect x="350" y="40" width="180" height="60" rx="4" fill="#e8edf4" stroke="#34435c"/><text x="388" y="76" font-size="20">Evidence</text></svg>');
const groups = buildReflowSegmentGroups([segment,
  { uid: 'preview-figure', segment_type: 'figure', raw_type: 'image', page_idx: 0, bbox: null, asset_path: sampleImage, text: '', markdown: '```mermaid\ngraph LR\nA[Source] --> B[Parsed flowchart]\n```' },
  { uid: 'preview-table', segment_type: 'table', raw_type: 'table', page_idx: 1, bbox: null, asset_path: sampleImage, text: '', markdown: '| Model | Score |\n|---|---|\n| Parsed model | 92% |' },
]);
const translations = [{ id: 1, source: 'Dr. Lee measured a 3.5% improvement in accuracy [1].', translation: '李博士测得准确率提高了 3.5% [1]。' },
  { id: 2, source: 'The results suggest that the model can preserve evidence across multiple stages.', translation: '结果表明，该模型能够在多个阶段中保留证据。' }];
let record: ParagraphTranslation | undefined;
const documentOnly = new URLSearchParams(location.search).has('documentTranslation');
const documentTranslations = new Map<string, TranslatedSegment>(documentOnly ? [[segment.uid, {
  segment_uid: segment.uid, page_idx: 0, segment_type: 'paragraph', source_hash: 'fixture', source_text: source,
  translated_text: translations.map(pair => pair.translation).join(''), status: 'translated', error: null, updated_at: '',
}]] : []);
let modelRequests = 0;
let failSentences = false;
let stage = 0;
let sequence = 0;
async function advance() {
  if (!record) return;
  stage++;
  for (const part of ['paragraph', 'sentences'] as const) {
    if (record[part].status !== 'running') continue;
    const timing = { queued_ms: 1000, rate_limit_ms: 2000, generation_ms: Math.max(0, stage - 2) * 1000, total_ms: stage * 1000 };
    if (stage >= 5) {
      if (part === 'paragraph') record.paragraph = { status: 'succeeded', value: translations.map(t => t.translation).join(''), error: null, timing };
      else record.sentences = failSentences ? { status: 'failed', value: record.sentences.value, error: '模拟逐句请求失败', timing } : { status: 'succeeded', value: translations, error: null, timing };
    } else {
      const payload: ParagraphLiveProgress = { root: 'preview-only', entry_id: 'preview-entry', segment_uid: segment.uid, job_id: record.job_id, source_hash: record.source_hash,
        part, phase: stage === 1 ? 'queued' : stage === 2 ? 'rate_limited' : 'generating', sequence: ++sequence, retry_after_ms: stage === 2 ? 2000 : null,
        paragraph: part === 'paragraph' && stage >= 3 ? translations.map(t => t.translation).join('').slice(0, stage === 3 ? 14 : 28) : null,
        sentences: part === 'sentences' && stage >= 3 ? translations.slice(0, stage === 3 ? 1 : 2) : [], sources: translations.map(t => t.source), timing };
      await emit('neuink://paragraph-translation-progress', payload);
    }
  }
  if (stage >= 5) await emit('neuink://job-event', { job: { kind: 'paragraph_translation', scope: { kind: 'entry', root: 'preview-only', entry_id: 'preview-entry' } } });
}
// Isolated browser fixture: no real workspace or model endpoint is accessed.
mockIPC(async (command, args) => {
  if (command === 'read_paragraph_translations') return record ? { [segment.uid]: structuredClone(record) } : {};
  if (command === 'set_paragraph_translation_view' && record) {
    record.view = (args as { request: { view: ParagraphView } }).request.view;
    return structuredClone(record);
  }
  if (command === 'translate_paragraph') {
    const retry = (args as { request: { retry_failed: boolean } }).request.retry_failed;
    if (!record && retry && documentOnly) record = { segment_uid: segment.uid, source_text: source, source_hash: 'fixture', job_id: 'fixture', model: 'fixture', view: 'sentences',
      paragraph: { status: 'succeeded', value: documentTranslations.get(segment.uid)!.translated_text, error: null }, sentences: { status: 'running', value: null, error: null } };
    const paragraph = !retry || record?.paragraph.status !== 'succeeded';
    const sentences = !retry || record?.sentences.status !== 'succeeded';
    modelRequests += Number(paragraph) + Number(sentences);
    record ??= { segment_uid: segment.uid, source_text: source, source_hash: 'fixture', job_id: 'fixture', model: 'fixture', view: 'sentences',
      paragraph: { status: 'running', value: null, error: null }, sentences: { status: 'running', value: null, error: null } };
    if (paragraph) record.paragraph.status = 'running';
    if (sentences) record.sentences.status = 'running';
    record.job_id = `fixture-${modelRequests}`;
    stage = 0;
    return structuredClone(record);
  }
  return undefined;
}, { shouldMockEvents: true });

function Preview() {
  const [preferences, setPreferences] = useState(readStoredReaderPreferences);
  const [narrow, setNarrow] = useState(false);
  const [count, setCount] = useState(0);
  const [failure, setFailure] = useState(false);
  return <TooltipProvider><ToastContext.Provider value={previewToast}>
    <main className="h-screen overflow-auto bg-muted p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ReflowComponentControls preferences={preferences} onChange={setPreferences} />
        <Button size="sm" onClick={() => setNarrow(v => !v)}>切换 320px 窄栏</Button>
        <Button size="sm" onClick={() => { failSentences = !failure; setFailure(!failure); }}>{failure ? '恢复成功响应' : '模拟逐句失败'}</Button>
        <Button size="sm" onClick={() => setCount(modelRequests)}>检查请求数</Button><Button size="sm" onClick={() => void advance()}>下一步响应</Button><span>请求数：{count}</span>
      </div>
      <div className="max-w-full bg-card p-3" style={{ width: narrow ? 320 : 700 }}>
        <p className="mb-2 text-sm text-muted-foreground">右键段落：翻译此段／整段对照／逐句对照。也可使用 Shift+F10。</p>
        <ParagraphTranslationProvider root="preview-only" entryId="preview-entry">
        <ReflowComponentPreferencesProvider value={preferences.reflowComponents}>
        <ReflowSegmentPreferencesProvider root="preview-only" entryId="preview-entry">
          {groups.map(group => <ReflowSegmentGroupView key={group.id} active={false} annotationsBySegmentUid={new Map()} entryId="preview-entry" flashed={false} hoverPreviewEnabled={false}
            notesBySegmentUid={new Map()} pdfDocument={null} reflowTranslationMode={preferences.reflowTranslationMode} segmentGroup={group} translationBySegmentUid={documentTranslations}
            sourceLinkCountBySegmentUid={new Map()} sourceBacklinksBySegmentUid={{}} workspaceRoot="preview-only" onActivateSegment={noop}
            onOpenSegmentAnnotation={noop} onOpenSegmentNote={noop} onPreviewChange={noop} onRequirePdfDocument={noop} onHideSegment={noop}
            onCopyContent={noop} onCopySourceLink={noop} onOpenSourceBacklink={noop} />)}
        </ReflowSegmentPreferencesProvider>
        </ReflowComponentPreferencesProvider>
        </ParagraphTranslationProvider>
      </div>
    </main>
  </ToastContext.Provider></TooltipProvider>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
