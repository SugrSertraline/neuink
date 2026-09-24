import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReflowToolbar } from '@/modules/reader/components/reflow/ReflowToolbar';
import { ReflowAppearanceControls } from '@/modules/reader/components/reflow/ReflowAppearanceControls';
import { ReflowComponentControls } from '@/modules/reader/components/reflow/ReflowComponentControls';
import { ReaderToolbar, HoverPreviewControls } from '@/modules/reader/components/pdf-reader/ReaderToolbar';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryTranslation } from '@/shared/ipc/workspaceApi';

const noop = () => undefined;
const entry: LibraryEntry = { id: 'toolbar-preview', title: 'Making Machine Scale Evidence Human Inspectable — Long Paper Title', contents: [], tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: 'long-paper-title.pdf', parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 };
const translation: EntryTranslation = {
  created_at: '', updated_at: '', entry_id: entry.id, error: null, model: null, paper_context: null,
  progress: { failed: 0, skipped: 0, total: 1, translated: 1 }, schema_version: 1,
  source_language: 'en', target_language: 'zh', status: 'succeeded',
  segments: [{ error: null, page_idx: 0, segment_type: 'paragraph', segment_uid: 'preview-segment', source_hash: '',
    source_text: 'Example', status: 'translated', translated_text: '示例', updated_at: '' }],
};

/** Real toolbar components with isolated callbacks; never accesses a workspace. */
export function ReaderToolbarPreview() {
  const [width, setWidth] = useState(320);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState(readStoredReaderPreferences);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const previous = document.documentElement.style.zoom;
    document.documentElement.style.zoom = String(scale);
    return () => { document.documentElement.style.zoom = previous; };
  }, [scale]);
  return <main className="h-screen overflow-auto bg-background p-4">
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {[260, 320, 420, 680, 1000].map(value => <Button key={value} size="sm" onClick={() => setWidth(value)}>{value}px</Button>)}
      <Button size="sm" onClick={() => setScale(scale === 1 ? 1.25 : 1)}>缩放 {scale === 1 ? '125%' : '100%'}</Button>
      <Button size="sm" onClick={() => setBusy(!busy)}>切换忙碌状态</Button>
      <span role="status">{message}</span>
    </div>
    <div style={{ width }} className="space-y-6">
      <section className="border" aria-label="重排工具栏检查">
        <ReflowToolbar compact={false} busy={busy} entryTitle={entry.title}
          appearance={<ReflowAppearanceControls preferences={preferences} onChange={setPreferences} />}
          translationMode={<Select defaultValue="bilingual"><SelectTrigger aria-label="原文与译文显示" className="w-[116px]" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="source">原文</SelectItem><SelectItem value="translation">译文</SelectItem><SelectItem value="bilingual">双语对照</SelectItem></SelectContent></Select>}>
          <ReflowComponentControls preferences={preferences} onChange={setPreferences} />
          <HoverPreviewControls mode="reflow" preferences={preferences} onChange={setPreferences} />
          <Button size="sm" onClick={() => setMessage('导出已触发')}>导出</Button>
          <Button size="sm" onClick={() => setMessage('翻译任务已触发')}>{busy ? '翻译任务进行中' : '翻译任务'}</Button>
        </ReflowToolbar>
        <p className="p-3 text-sm">重排正文区域</p>
      </section>
      <section className="border" aria-label="PDF 工具栏检查">
        <ReaderToolbar entry={entry} pageCount={27} segmentCount={328} recommendedTags={[]} selectedRecommendedTagPaths={[]}
          tagSuggestionBusy={false} tagSuggestionsOpen={false} translation={translation} translationBusy={busy} reparseBusy={busy}
          readerPreferences={preferences} onReaderPreferencesChange={setPreferences} zoom={0.8}
          onZoomIn={noop} onZoomOut={noop} onApplyRecommendedTags={noop} onDismissRecommendedTags={noop}
          onRecommendedTagToggle={noop} onTagSuggestionsOpenChange={noop} onExportTranslation={noop}
          onExportPaper={() => setMessage('PDF 导出已触发')} onPauseTranslation={noop} onOpenTranslationTask={noop}
          onOpenPdf={noop} onRevealPdf={noop} onReparsePdf={noop} />
        <p className="p-3 text-sm">PDF 正文区域</p>
      </section>
    </div>
  </main>;
}
