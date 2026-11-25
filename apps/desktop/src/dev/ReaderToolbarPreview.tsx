import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReflowToolbar } from '@/modules/reader/components/reflow/ReflowToolbar';
import { ReflowAppearanceControls } from '@/modules/reader/components/reflow/ReflowAppearanceControls';
import { ReflowComponentControls } from '@/modules/reader/components/reflow/ReflowComponentControls';
import { ReaderToolbar, HoverPreviewControls } from '@/modules/reader/components/pdf-reader/ReaderToolbar';
import { ReadingViewSession } from '@/modules/reader/components/navigation/ReadingViewSession';
import { ReadingNavigationScope } from '@/modules/reader/components/navigation/ReadingNavigation';
import { ReadingNavigationControls } from '@/modules/reader/components/navigation/ReadingNavigationControls';
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
  const [width, setWidth] = useState(1000);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState(readStoredReaderPreferences);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(.8);
  const [tagsOpen, setTagsOpen] = useState(false);
  useEffect(() => {
    const previous = document.documentElement.style.zoom;
    document.documentElement.style.zoom = String(scale);
    return () => { document.documentElement.style.zoom = previous; };
  }, [scale]);
  return <main className="h-screen overflow-auto bg-background p-4">
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {[260, 320, 420, 680, 840, 1000, 1440, 1600].map(value => <Button key={value} size="sm" onClick={() => setWidth(value)}>{value}px</Button>)}
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
        <ReadingViewSession surface={{ kind: 'pdf', entryId: entry.id }} workspaceRoot="toolbar-preview" active><ReadingNavigationScope>
        <ReaderToolbar entry={entry} navigation={<ReadingNavigationControls segments={[]} entryId={entry.id} workspaceRoot={null} />}
          currentPage={page} onCurrentPageChange={setPage} searchQuery={query} onSearchQueryChange={setQuery}
          searchStatus={query ? 'ready' : 'idle'} searchMatchCount={query ? 3 : 0} searchActiveMatchNumber={query ? 1 : 0}
          onSearchNext={() => setMessage('下一个匹配')} onSearchPrevious={() => setMessage('上一个匹配')} pageCount={27} segmentCount={328} recommendedTags={[]} selectedRecommendedTagPaths={[]}
          tagSuggestionBusy={busy} tagSuggestionPhase={busy ? 'generating' : 'idle'} tagSuggestionsOpen={tagsOpen} onGenerateRecommendedTags={() => setMessage('生成推荐标签')} translation={translation} translationBusy={busy} translationMessage="正在翻译 · 等待模型正文" reparseBusy={busy}
          readerPreferences={preferences} onReaderPreferencesChange={setPreferences} zoom={zoom}
          onZoomIn={() => setZoom(z => z + .01)} onZoomOut={() => setZoom(z => z - .01)} onZoomReset={() => setZoom(1)} onApplyRecommendedTags={noop} onDismissRecommendedTags={noop}
          onRecommendedTagToggle={noop} onTagSuggestionsOpenChange={setTagsOpen} onExportTranslation={noop}
          onExportPaper={() => setMessage('PDF 导出已触发')} onPauseTranslation={() => setMessage('暂停翻译')} onCancelTranslation={() => setMessage('取消翻译')} onOpenTranslationTask={() => setMessage('打开翻译任务')}
          onOpenPdf={noop} onRevealPdf={noop} />
        </ReadingNavigationScope></ReadingViewSession>
        <p className="p-3 text-sm">PDF 正文区域</p>
      </section>
    </div>
  </main>;
}
