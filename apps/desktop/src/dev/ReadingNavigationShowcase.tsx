import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppearanceProvider, useAppearance } from '@/shared/components/AppearanceProvider';
import { ToastContext, type ToastInput } from '@/shared/hooks/useToast';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import type { Annotation, SegmentBlockNote, SourceSegment } from '@/shared/types/domain';
import type { EntryTranslation } from '@/shared/ipc/workspaceApi';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { MineruPdfReader } from '@/modules/reader/components/MineruPdfReader';
import { ReflowEntryReader } from '@/modules/reader/components/reflow/ReflowEntryReader';
import { SegmentBookmarksProvider } from '@/modules/reader/components/SegmentBookmarks';
import { WorkspaceSurfaceDeck } from '@/modules/reader/components/WorkspaceSurfaceDeck';
import { ReadingStateRetention, useRetainedReadingSnapshot } from '@/modules/reader/components/navigation/ReadingStateRetention';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { readerPdfFixture } from './readerPdfFixture';
import '../styles/globals.css';

const noop = () => undefined;
const unavailable = async (): Promise<never> => { throw new Error('此检查页不操作工作区文件'); };
const emptyRecords = async () => [];
const twoColumnReferences = new URLSearchParams(window.location.search).has('twoColumns');
const translatedReferences = twoColumnReferences && new URLSearchParams(window.location.search).has('translatedReferences');
const denseRail = new URLSearchParams(window.location.search).has('denseRail');
const longNotes = new URLSearchParams(window.location.search).has('longNotes');
const bytes = readerPdfFixture(true, new URLSearchParams(window.location.search).has('brokenReference'), twoColumnReferences);
// Real reader components and PDF.js; all persistence stays in this page's memory.
mockIPC(async command => {
  if (command === 'read_pdf_bytes') return Array.from(bytes);
  if (command === 'list_jobs') return [];
  if (command === 'read_paragraph_translations') return {};
  if (command === 'read_entry_translation') return { translation: translatedReferences ? referenceTranslation : null };
  return null;
}, { shouldMockEvents: true });
const entry: LibraryEntry = { id: 'navigation-fixture', title: '文内预览与笔记定位', contents: [], tagIds: [], tags: [], fields: {},
  createdAt: '', updatedAt: '', pdfFileName: 'reading-navigation.pdf', parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 };
function SnapshotProbe({ kind, report }: { kind: string; report: (text: string) => void }) {
  const snapshot = useRetainedReadingSnapshot(JSON.stringify([kind, translatedReferences ? 'navigation-fixture' : null, entry.id, entry.pdfFileName]));
  return new URLSearchParams(window.location.search).has('retentionDebug')
    ? <Button className="absolute bottom-0 right-0 z-10" size="sm" onClick={() => report(JSON.stringify(snapshot.position))}>查看{kind}锚点</Button> : null;
}
const paragraph = (uid: string, text: string, page_idx: number, bbox: SourceSegment['bbox'] = [80, 216, 920, 607]): SourceSegment => ({ uid, text, markdown: null, page_idx, bbox, segment_type: 'paragraph' });
const segments: SourceSegment[] = [
  { ...paragraph('heading', 'Reading across research papers', 0, [80, 78, 920, 132]), segment_type: 'heading' },
  paragraph('intro', twoColumnReferences ? 'Compare [1] and [12]. These references are in different columns at the same height.' : 'Compare Figure 3 and reference [1]. Hover to preview; click to read the original source.\n\nRight-click this paragraph to keep a reading position without writing a note.', 0),
  ...Array.from({ length: denseRail ? 180 : 8 }, (_, i) => paragraph(`body-${i}`, `Reading paragraph ${i + 1}. Evidence from multiple sources can be compared in a shared research note. Keep the original document readable while navigating between papers.`, 1)),
  { ...paragraph('figure', '', 2, [80, 636, 918, 796]), segment_type: 'figure', visual_group_id: 'v3' },
  { ...paragraph('caption', 'Figure 3. Research evidence grouped by source.', 2, [80, 830, 930, 854]), block_role: 'caption', visual_group_id: 'v3' },
  ...Array.from({ length: 4 }, (_, i) => paragraph(`discussion-${i}`, `Discussion ${i + 1}. The original paper provides useful context for interpreting these results.`, 2)),
  { ...paragraph('references-heading', '7 References', 3, [80, 165, 920, 195]), segment_type: 'heading' },
  twoColumnReferences ? { ...paragraph('reference', '[1] Left-column paper. Smith 2024.\n[12] Right-column paper. Lee 2026.', 3, [80, 214, 950, 275]),
    segment_type: 'list', sub_type: 'reference', mineru_metadata: { list_item_regions: JSON.stringify([
      { text: '[12] Right-column paper. Lee 2026.', page_idx: 3, bbox: [520, 214, 950, 235] },
      { text: '[1] Left-column paper. Smith 2024.', page_idx: 3, bbox: [80, 214, 480, 235] }
    ]) } } : paragraph('reference', '[1] NeuInk reading study. Comparing research evidence. 2026.', 3, [80, 214, 920, 235])
];
const referenceTranslation: EntryTranslation = {
  created_at: '', updated_at: '', entry_id: entry.id, error: null, model: 'fixture', paper_context: null,
  progress: { failed: 0, skipped: 0, total: 1, translated: 1 }, schema_version: 1,
  source_language: 'en', target_language: 'zh', status: 'succeeded',
  segments: [{ error: null, page_idx: 3, segment_type: 'list', segment_uid: 'reference', source_hash: 'fixture',
    source_text: segments[segments.length - 1].text, status: 'translated', updated_at: '',
    translated_text: '[1] 左栏文献译文。Smith 2024。\n[12] 右栏文献译文。Lee 2026。' }],
};
if (longNotes) {
  segments[1] = { ...segments[1], text: Array.from({ length: 45 }, (_, i) => `Source paragraph ${i + 1}. Evidence from multiple papers needs enough context to verify the original claim.`).join('\n\n') };
}

function Showcase() {
  const { appearance, setAppearance } = useAppearance();
  const [mode, setMode] = useState<'split' | 'pdf' | 'reflow'>('split');
  const [swapped, setSwapped] = useState(false);
  const [releaseInactive, setReleaseInactive] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [short, setShort] = useState(false);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const previous = document.documentElement.style.zoom;
    document.documentElement.style.zoom = String(scale);
    return () => { document.documentElement.style.zoom = previous; };
  }, [scale]);
  const [failSave, setFailSave] = useState(false);
  const [message, setMessage] = useState('');
  const notify = useCallback((toast: ToastInput) => { setMessage(`${toast.title} ${toast.description ?? ''}`); return 'fixture'; }, []);
  const [preferences, setPreferences] = useState(readStoredReaderPreferences);
  const [reload, setReload] = useState(0);
  const notes = useRef<SegmentBlockNote[]>([
    { segment_uid: 'intro', text: longNotes ? Array.from({ length: 45 }, (_, i) => `阅读笔记第 ${i + 1} 段：这是一篇长笔记，需要查看后面的结论，也需要随时打开对应原文。`).join('\n\n') : '这条现有笔记自动成为阅读定位点。', bookmarked: false, created_at: '', updated_at: '' },
    { segment_uid: 'reference', text: '', bookmarked: true, created_at: '', updated_at: '' }
  ]);
  const read = useCallback(async () => ({ pdf_path: 'fixture.pdf', segments, segment_notes: notes.current, annotations: [{ annotation_id: 'rail-fixture', segment_uid: 'body-0', kind: 'comment', content: '此处有批注，可以从左侧快速找到。', importance: 'normal', created_at: '', updated_at: '' } as Annotation] }), []);
  const update = useCallback(async (uid: string, value: Partial<SegmentBlockNote>) => {
    if (failSave) throw new Error('模拟写入失败');
    const existing = notes.current.find(note => note.segment_uid === uid);
    notes.current = [...notes.current.filter(note => note.segment_uid !== uid), { segment_uid: uid, text: '', created_at: '', updated_at: '', ...existing, ...value }];
    setReload(n => n + 1);
    return notes.current;
  }, [failSave]);
  const saveBookmark = useCallback((uid: string, bookmarked: boolean) => update(uid, { bookmarked }), [update]);
  const saveNote = useCallback((_entry: string, uid: string, text: string) => update(uid, { text }), [update]);
  const common = { entry, recordReloadKey: reload, pairedMarkdownNoteTarget: null, readerPreferences: preferences, onReaderPreferencesChange: setPreferences,
    sourceBacklinksBySegmentUid: {}, workspaceRoot: translatedReferences ? 'navigation-fixture' : null, onReadPdfReader: read, onSaveSegmentNote: saveNote,
    onCreateMarkdownSourceLink: unavailable, onQueuePendingSourceLinkInsertion: noop, onOpenSourceBacklink: noop,
    onOpenSegmentNotesSurface: noop, onOpenAnnotationsSurface: noop, onExportTranslationNote: async () => undefined,
    onSaveAnnotation: emptyRecords, onDeleteAnnotation: emptyRecords };
  const pdf = { kind: 'pdf' as const, entryId: entry.id }, reflow = { kind: 'reflow' as const, entryId: entry.id };
  const first = swapped ? reflow : pdf, second = swapped ? pdf : reflow;
  const layout: WorkspaceSurfaceLayout = mode === 'split'
    ? { focusedPane: 'left', left: first, leftTabs: [first], right: second, rightTabs: [second] }
    : { focusedPane: 'left', left: mode === 'pdf' ? pdf : reflow, leftTabs: [pdf, reflow], right: null, rightTabs: [] };
  return <ToastContext.Provider value={{ dismiss: noop, notify }}>
    <main className="flex min-w-0 flex-col bg-background text-foreground" style={{ height: `${100 / scale}vh` }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
        {(['split', 'pdf', 'reflow'] as const).map(value => <Button key={value} size="sm" variant={mode === value ? 'secondary' : 'outline'} onClick={() => setMode(value)}>{value === 'split' ? '分屏检查' : value === 'pdf' ? '仅 PDF' : '仅重排版'}</Button>)}
        <Button size="sm" variant="outline" onClick={() => setSwapped(value => !value)}>交换两侧</Button>
        <Button size="sm" variant="outline" aria-pressed={releaseInactive} onClick={() => setReleaseInactive(value => !value)}>模拟后台闲置释放</Button>
        <Button size="sm" variant="outline" aria-pressed={narrow} onClick={() => setNarrow(v => !v)}>320px 窄栏</Button>
        <Button size="sm" variant="outline" aria-pressed={short} onClick={() => setShort(v => !v)}>320px 高度</Button>
        <Button size="sm" variant="outline" onClick={() => setScale(v => v === 1 ? 1.25 : 1)}>{scale === 1 ? '125%' : '100%'}</Button>
        <Button size="sm" variant="outline" aria-pressed={failSave} onClick={() => setFailSave(v => !v)}>模拟保存失败</Button>
        {([['standard', '标准'], ['atelier', '拟物'], ['liquid-glass', '玻璃']] as const).map(([value, label]) => <Button key={value} size="sm" variant="outline" aria-pressed={appearance === value} onClick={() => setAppearance(value)}>{label}</Button>)}
        {message ? <span role="status" className="text-xs text-destructive">{message}</span> : null}
      </div>
      <div className="workspace-split min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: mode === 'split' ? 'minmax(0,1fr) 8px minmax(0,1fr)' : 'minmax(0,1fr)', width: narrow ? 320 : '100%', maxHeight: short ? 320 : undefined }}>
        <WorkspaceSurfaceDeck layout={layout} onFocus={noop} renderSurface={(surface, _sibling, _pane, active) => <ReadingStateRetention><SnapshotProbe kind={surface.kind} report={setMessage} />{active || !releaseInactive ? surface.kind === 'pdf' ? <SegmentBookmarksProvider save={saveBookmark}><MineruPdfReader {...common} editorScopeKey="fixture-pdf"
          markdownNoteRefreshById={{}} jumpRequest={null} reloadKey={0} sharedSegmentNoteDrafts={{}} pendingSourceLinkInsertion={null} pendingNoteImageInsertion={null}
          sidePane={{ pinned: false, requestKey: 0, target: null }} sidePaneEntry={null} onApplyEntryTagPaths={noop}
          onImportMarkdownNoteSegmentAsset={unavailable} onReadMarkdownNote={unavailable} onRetryPdfParse={noop} onStartPdfParse={noop} onCloseSidePane={noop}
          onOpenSourceLink={noop} onConsumePendingSourceLinkInsertion={noop} onConsumePendingNoteImageInsertion={noop} onSharedSegmentNoteDraftChange={noop}
          onQueuePendingNoteImageInsertion={noop} onToggleSidePanePinned={noop} onSaveMarkdownNote={unavailable} /></SegmentBookmarksProvider>
          : <SegmentBookmarksProvider save={saveBookmark}><ReflowEntryReader {...common} editorScopeKey="fixture-reflow" /></SegmentBookmarksProvider> : null}</ReadingStateRetention>} />
      </div>
    </main>
  </ToastContext.Provider>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<AppearanceProvider><TooltipProvider><Showcase /></TooltipProvider></AppearanceProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
