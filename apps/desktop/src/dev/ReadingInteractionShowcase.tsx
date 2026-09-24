import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { SourceSegment } from '@/shared/types/domain';
import type { AssistantContextItem } from '@/shared/types/assistant';
import { AssistantReadingContextControl } from '@/modules/assistant/components/AssistantReadingContextControl';
import { AssistantExternalContextItems } from '@/modules/assistant/components/AssistantExternalContextItems';
import { resolveAssistantReadingContext, type AssistantReadingChoice } from '@/modules/assistant/components/assistantReadingContext';
import { PdfTextSelectionToolbar } from '@/modules/reader/components/pdf-reader/PdfTextSelectionToolbar';
import { useReflowTextSelection } from '@/modules/reader/components/reflow/useReflowTextSelection';
import { readingAssistantContext } from '@/modules/reader/components/readingAssistantContext';

const entry: LibraryEntry = { id: 'demo', title: '研究论文：面向复杂阅读场景的证据溯源与交互设计', contents: [{ kind: 'note', note_id: 'n', title: '论文阅读笔记' }],
  tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: 'demo.pdf', parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 };
const segment: SourceSegment = { uid: 's', page_idx: 2, text: 'Direct manipulation keeps the evidence close to the reader. Selected passages should remain attached to their original source.', markdown: null, bbox: null, segment_type: 'paragraph' };
const segments = [segment];

/** Isolated UI fixtures: no workspace reads, model requests or persisted edits. */
function Showcase() {
  const [width, setWidth] = useState(240), [scale, setScale] = useState(1);
  const [choice, setChoice] = useState<AssistantReadingChoice>(null);
  const [items, setItems] = useState<AssistantContextItem[]>([]);
  const [message, setMessage] = useState('选择右侧文字，测试翻译、提问和解释。');
  const ref = useRef<HTMLDivElement>(null), selection = useReflowTextSelection(ref, segments);
  const context = resolveAssistantReadingContext({ choice, entries: [entry], items, activeEntry: entry, activeNote: null, activeSegment: null,
    activeSurface: { kind: 'reflow', entryId: entry.id, noteId: null, segmentUid: null, pane: 'left', capturedAt: '', surfaceKey: 'reflow:demo' } });
  useEffect(() => { document.documentElement.style.zoom = String(scale); return () => { document.documentElement.style.zoom = ''; }; }, [scale]);
  return <ToastContext.Provider value={{ dismiss: () => {}, notify: () => '' }}><TooltipProvider>
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="mb-4 flex flex-wrap gap-2">{[220, 320, 440].map(value => <Button key={value} size="sm" onClick={() => setWidth(value)}>{value}px</Button>)}
        <Button size="sm" onClick={() => setScale(scale === 1 ? 1.25 : 1)}>{scale === 1 ? '125%' : '100%'}</Button></div>
      <div className="flex items-start gap-4">
        <aside className="shrink-0 border bg-card p-2" style={{ width }}>
          <AssistantExternalContextItems items={items} onRemove={id => setItems(values => values.filter(item => item.id !== id))} />
          <AssistantReadingContextControl entries={[entry]} context={context} choice={choice} busy={false} onChange={setChoice} />
          <textarea aria-label="测试问题" className="w-full border bg-background p-2 text-sm" placeholder="输入问题" />
        </aside>
        <div ref={ref} onPointerUp={selection.capture} onKeyUp={event => { if (event.shiftKey) selection.capture(); }} className="min-w-0 flex-1 border bg-card p-6 text-base leading-8">
          <h1 className="mb-3 font-semibold">第 3 页 · 选区交互测试</h1><p data-reading-selection-source="s">{segment.text}</p>
        </div>
      </div>
      <p role="status" className="mt-4 text-sm">{message}</p>
      <PdfTextSelectionToolbar pending={selection.pending} onClose={selection.close}
        onTranslate={async () => '【测试译文】直接操作让证据保持在读者身边。'}
        onAsk={({ segment: source, text }, intent) => {
          const item = readingAssistantContext(entry, source, { selectionText: text });
          setItems([{ ...item, id: item.id!, addedAt: '' }]);
          setMessage(`${intent === 'ask' ? '提问' : '解释'}已附加选区：${text}`); selection.close();
        }} />
    </main>
  </TooltipProvider></ToastContext.Provider>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Showcase />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
