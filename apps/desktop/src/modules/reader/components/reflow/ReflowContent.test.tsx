/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import { DEFAULT_REFLOW_COMPONENT_PREFERENCES, readStoredReaderPreferences, withReflowDisplayOptions } from '@/shared/lib/readerPreferences';
import { resolveReflowContent, type ReflowComponentContent } from '@/shared/lib/reflowContentPreferences';
import type { SourceSegment } from '@/shared/types/domain';
import type { ParagraphTranslation } from '@/shared/ipc/paragraphTranslationApi';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import { ReflowSegmentPreferencesProvider } from './ReflowSegmentPreferences';
import { ReflowComponentPreferencesProvider } from './ReflowComponentPreferencesContext';
import { ReflowSegmentGroupView } from './ReflowSegmentGroupView';
import { ReflowContentLayers } from './ReflowContentLayers';
import { buildReflowSegmentGroups } from './buildReflowBlocks';
import { readCachedPdfSegmentSnapshot } from './pdfSourceSnapshot';

const { translate, setView } = vi.hoisted(() => ({ translate: vi.fn(), setView: vi.fn() }));
let record: ParagraphTranslation | undefined;
let pending = new Set<string>();
vi.mock('./ParagraphTranslationContext', () => ({
  useParagraphTranslation: () => ({ record, context: { pending, ready: true, translate, setView } }),
  useParagraphProgress: () => ({}),
}));
vi.mock('./pdfSourceSnapshot', () => ({ readCachedPdfSegmentSnapshot: vi.fn(), warmCachedPdfSegmentSnapshot: vi.fn() }));
vi.mock('../navigation/PaperReferences', () => ({ PaperTextPreview: ({ markdown }: { markdown: string }) => <div>{markdown}</div> }));

const noop = () => {};
const image: SourceSegment = { uid: 'image-1', segment_type: 'figure', raw_type: 'image', page_idx: 0, bbox: null, asset_path: 'https://example.com/source.png', text: '', markdown: '```mermaid\ngraph TD\nA-->B\n```' };
const paragraph: SourceSegment = { uid: 'p1', segment_type: 'paragraph', page_idx: 0, bbox: null, markdown: null, text: 'First. Second.' };
const translatedParagraph = (text: string, source = paragraph.text) => new Map<string, TranslatedSegment>([['p1', {
  segment_uid: 'p1', page_idx: 0, segment_type: 'paragraph', source_hash: 'hash', source_text: source,
  translated_text: text, status: 'translated', error: null, updated_at: '',
}]]);
function surface({ root = 'workspace', entry = 'entry', source = image, content = {}, translations = new Map(), mode = 'source', focusedSentenceIndex,
  active = false, flashed = false, sentenceLinked = false }: { root?: string; entry?: string; source?: SourceSegment; content?: ReflowComponentContent; translations?: Map<string, TranslatedSegment>; mode?: 'source' | 'translation' | 'bilingual' | 'sentences'; focusedSentenceIndex?: number;
  active?: boolean; flashed?: boolean; sentenceLinked?: boolean } = {}) {
  return <TooltipProvider><ToastContext.Provider value={{ notify: () => 'test', dismiss: noop }}>
    <ReflowComponentPreferencesProvider value={{ ...DEFAULT_REFLOW_COMPONENT_PREFERENCES, content }}>
      <ReflowSegmentPreferencesProvider root={root} entryId={entry}>
        <ReflowSegmentGroupView active={active} annotationsBySegmentUid={new Map()} entryId={entry} flashed={flashed} hoverPreviewEnabled={false}
          focusedSentenceIndex={focusedSentenceIndex}
          sentenceLinked={sentenceLinked}
          notesBySegmentUid={new Map()} pdfDocument={null} reflowTranslationMode={mode} segmentGroup={buildReflowSegmentGroups([source])[0]}
          translationBySegmentUid={translations} sourceLinkCountBySegmentUid={new Map()} sourceBacklinksBySegmentUid={{}} workspaceRoot={root}
          onActivateSegment={noop} onOpenSegmentAnnotation={noop} onOpenSegmentNote={noop} onPreviewChange={noop} onRequirePdfDocument={noop}
          onHideSegment={noop} onCopyContent={noop} onCopySourceLink={noop} onOpenSourceBacklink={noop} />
      </ReflowSegmentPreferencesProvider>
    </ReflowComponentPreferencesProvider>
  </ToastContext.Provider></TooltipProvider>;
}
function openMenu(uid = 'image-1') { fireEvent.contextMenu(document.getElementById(`reflow-segment-${uid}`)!, { clientX: 30, clientY: 40 }); }
beforeEach(() => { localStorage.clear(); record = undefined; pending = new Set(); vi.clearAllMocks(); });
afterEach(cleanup);

describe('reflow content display', () => {
  it.each([
    ['source', true, false, false],
    ['translation', false, true, false],
    ['bilingual', true, true, false],
    ['sentences', true, true, true],
  ] as const)('keeps %s as a distinct reflow display mode', (mode, showsSource, showsTranslation, paired) => {
    const { container } = render(surface({ source: paragraph, mode, translations: translatedParagraph('第一句。第二句。') }));
    expect(Boolean(screen.queryByText(paragraph.text))).toBe(showsSource && !paired);
    expect(Boolean(screen.queryByText('第一句。第二句。'))).toBe(showsTranslation && !paired);
    expect(Boolean(screen.queryByText('第一句。'))).toBe(paired);
    expect(Boolean(container.querySelector('[data-paragraph-translation="sentences"]'))).toBe(paired);
    expect(translate).not.toHaveBeenCalled();
  });
  it('shows the original and requests the existing whole-document translation when no result exists', () => {
    render(surface({ source: paragraph, mode: 'sentences' }));
    expect(translate).not.toHaveBeenCalled();
    expect(screen.getByText('暂无整段译文，请先运行整体翻译。')).toBeTruthy();
    expect(screen.getByText('First.')).toBeTruthy();
    expect(screen.getByText('Second.')).toBeTruthy();
    expect(screen.queryByText(/本地词义提示/)).toBeNull();
  });
  it('aligns an existing document translation by sentence without another AI request', () => {
    const translations = new Map<string, TranslatedSegment>([['p1', { segment_uid:'p1', page_idx:0,
      segment_type:'paragraph', source_hash:'hash', source_text:paragraph.text, translated_text:'第一句。第二句。',
      status:'translated', error:null, updated_at:'' }]]);
    render(surface({ source:paragraph, mode:'sentences', translations }));
    expect(screen.getByText(/整体翻译 · 按标点、数字与顺序逐句配对/)).toBeTruthy();
    expect(screen.getByText('第一句。')).toBeTruthy();
    expect(screen.getByText('第二句。')).toBeTruthy();
    expect(translate).not.toHaveBeenCalled();
  });
  it('highlights the translated sentence targeted by a PDF click', () => {
    const { container } = render(surface({ source: paragraph, mode: 'sentences', focusedSentenceIndex: 1,
      translations: translatedParagraph('第一句。第二句。') }));
    const target = container.querySelector('[data-reading-segment-uid="p1"][data-reading-sentence-index="1"]');
    expect(target?.textContent).toContain('第二句。');
    expect(target?.className).toContain('ring-primary/40');
    expect(container.querySelector('[data-reading-segment-uid="p1"][data-reading-sentence-index="0"]')?.className)
      .not.toContain('ring-primary/40');
  });
  it('highlights a conservative source group when one saved translation covers two sentences', () => {
    const source: SourceSegment = { ...paragraph, text: 'TPSSL (Gao et al., 2024) applies masked modeling. It also employs contrastive learning. However, limitations remain.' };
    const translations = translatedParagraph('TPSSL（Gao等，2024）采用掩码建模，同时采用对比学习。然而，仍存在局限。', source.text);
    const { container } = render(surface({ source, mode: 'sentences', focusedSentenceIndex: 1, translations }));
    const group = container.querySelector('[data-reading-segment-uid="p1"][data-reading-sentence-index="0"]');
    expect(group?.getAttribute('data-reading-sentence-end-index')).toBe('2');
    expect(group?.textContent).toContain('It also employs contrastive learning.');
    expect(group?.className).toContain('ring-primary/40');
    expect(container.querySelector('[data-reading-sentence-index="2"]')?.className).not.toContain('ring-primary/40');
  });
  it('keeps the whole block unhighlighted for a linked sentence, including after its brief focus clears', () => {
    const { container, rerender } = render(surface({ source: paragraph, mode: 'sentences', focusedSentenceIndex: 1,
      active: true, flashed: true, sentenceLinked: true, translations: translatedParagraph('第一句。第二句。') }));
    const block = container.querySelector('#reflow-segment-p1')!;
    expect(block.className).not.toContain('segment-navigation-highlight');
    expect(block.className).not.toContain('bg-primary/5');
    expect(container.querySelector('[data-reading-sentence-index="1"]')?.className).toContain('ring-primary/40');
    rerender(surface({ source: paragraph, mode: 'sentences', active: true, flashed: true, sentenceLinked: true,
      translations: translatedParagraph('第一句。第二句。') }));
    expect(block.className).not.toContain('segment-navigation-highlight');
    expect(block.className).not.toContain('bg-primary/5');
  });
  it('shows separate original sentence rows when translation is switched off', () => {
    const { container } = render(surface({ source: paragraph, mode: 'sentences', focusedSentenceIndex: 1,
      content: { paragraph: { translation: false } }, translations: translatedParagraph('第一句。第二句。') }));
    expect(container.querySelectorAll('[data-reading-sentence-index]')).toHaveLength(2);
    expect(container.querySelector('[data-reading-sentence-index="1"]')?.className).toContain('ring-primary/40');
    expect(screen.queryByText('第一句。')).toBeNull();
    expect(screen.getByText('First.')).toBeTruthy();
    expect(screen.getByText('Second.')).toBeTruthy();
  });
  it.each([
    ['hidden', false, false, false, false],
    ['hidden', true, false, true, false],
    ['original', false, true, false, false],
    ['original', true, true, true, false],
    ['sentences', false, true, false, true],
    ['sentences', true, true, true, true],
  ] as const)('renders original=%s translation=%s', (original, translation, sourceVisible, translationVisible, sentenceRows) => {
    const preferences = withReflowDisplayOptions(readStoredReaderPreferences(), original, translation);
    const { container } = render(surface({ source: paragraph, mode: preferences.reflowTranslationMode,
      content: preferences.reflowComponents.content, translations: translatedParagraph('第一句。第二句。') }));
    expect(Boolean(screen.queryByText('First.')) || Boolean(screen.queryByText(paragraph.text))).toBe(sourceVisible);
    expect(Boolean(screen.queryByText('第一句。')) || Boolean(screen.queryByText('第一句。第二句。'))).toBe(translationVisible);
    expect(container.querySelectorAll('[data-reading-sentence-index]').length > 0).toBe(sentenceRows);
  });
  it('falls back to the saved full paragraph when sentence boundaries cannot be matched', () => {
    render(surface({ source: paragraph, mode: 'sentences', translations: translatedParagraph('合并译文。') }));
    expect(screen.getByText('合并译文。')).toBeTruthy();
    expect(screen.getByText(/句界无法可靠配对/)).toBeTruthy();
    expect(screen.queryByText(/本地词义提示/)).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });
  it('starts AI enhancement only after the user clicks its explicit action', () => {
    const translations = new Map<string, TranslatedSegment>([['p1', { segment_uid:'p1', page_idx:0,
      segment_type:'paragraph', source_hash:'hash', source_text:paragraph.text, translated_text:'第一句。第二句。',
      status:'translated', error:null, updated_at:'' }]]);
    render(surface({ source:paragraph, mode:'sentences', translations }));
    expect(translate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name:'AI 增强逐句翻译' }));
    expect(translate).toHaveBeenCalledExactlyOnceWith('p1', true);
  });
  it('does not submit a second request while a paragraph submission is pending', () => {
    pending.add('p1'); render(surface({ source: paragraph, mode:'sentences' })); openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '逐句对照' }));
    expect(translate).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it.each([false, true])('offers incremental sentence translation for a document translation (stale=%s)', stale => {
    const translations = new Map<string, TranslatedSegment>([['p1', { segment_uid: 'p1', page_idx: 0, segment_type: 'paragraph',
      source_hash: 'hash', source_text: stale ? 'Old source.' : paragraph.text, translated_text: '已有整段译文。', status: 'translated', error: null, updated_at: '' }]]);
    render(surface({ source: paragraph, mode:'sentences', translations })); openMenu('p1');
    fireEvent.click(screen.getByRole('menuitem', { name: stale ? 'AI 翻译此段' : 'AI 增强逐句翻译' }));
    expect(translate).toHaveBeenCalledExactlyOnceWith('p1', !stale);
    expect(screen.queryByRole('menu')).toBeNull();
    if (!stale) {
      expect(screen.getByText(/句界无法可靠配对/)).toBeTruthy();
    }
  });
  it.each(['figure', 'table'] as const)('shows only the original by default for %s, including an ungrouped visual segment', type => {
    render(surface({ source: { ...image, segment_type: type, raw_type: type === 'table' ? 'table' : 'image' } }));
    expect(screen.getByRole('img', { name: '片段原图' })).toBeTruthy();
    expect(screen.queryByText(/graph TD/)).toBeNull();
  });
  it('keeps a per-segment override through remounts and isolates entries/workspaces; reset follows bulk settings', () => {
    const { rerender } = render(surface());
    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示解析后内容' }));
    expect(screen.getByText(/graph TD/)).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示原图' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    rerender(surface({ entry: 'another' }));
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.queryByText(/graph TD/)).toBeNull();
    rerender(surface({ root: 'another-workspace' }));
    expect(screen.getByRole('img')).toBeTruthy();
    rerender(surface());
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/graph TD/)).toBeTruthy();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '恢复跟随组件设置' }));
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.queryByText(/graph TD/)).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    rerender(surface({ content: { figure: { original: false, parsed: true } } }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/graph TD/)).toBeTruthy();
  });
  it('allows an empty display to be restored from the same keyboard menu', () => {
    render(surface()); openMenu();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示原图' }));
    expect(screen.getByText('内容已关闭，右键可调整此片段显示。')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(document.getElementById('reflow-segment-image-1')!, { key: 'F10', shiftKey: true });
    const option = screen.getByRole('menuitemcheckbox', { name: '显示原图' });
    expect(option.getAttribute('aria-checked')).toBe('false');
    option.focus();
    fireEvent.keyDown(option, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('显示解析后内容');
    fireEvent.click(option);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('switches cached sentence/paragraph translations locally, respecting original and translation visibility', () => {
    record = { segment_uid: 'p1', source_text: paragraph.text, source_hash: 'hash', job_id: 'job', model: 'model', view: 'paragraph',
      paragraph: { status: 'succeeded', value: '整段译文。', error: null }, sentences: { status: 'succeeded', value: [
        { id: 1, source: 'First.', translation: '第一句。' }, { id: 2, source: 'Second.', translation: '第二句。' },
      ], error: null } };
    const { container } = render(surface({ source: paragraph, mode: 'sentences', translations: translatedParagraph('整段译文。') }));
    expect(screen.getByText('第一句。')).toBeTruthy();
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '逐句对照' }));
    expect(screen.getByText('第一句。')).toBeTruthy();
    expect(container.querySelectorAll('[data-paragraph-translation]')).toHaveLength(1);
    expect(container.querySelector('[lang="en"]')?.nextElementSibling?.textContent).toBe('第一句。');
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示解析后内容' }));
    expect(container.querySelectorAll('[lang="en"]')).toHaveLength(0);
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '整段对照' }));
    expect(screen.getByText('整段译文。')).toBeTruthy();
    expect(screen.queryByText('第一句。')).toBeNull();
    expect(translate).not.toHaveBeenCalled(); expect(setView).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示翻译' }));
    expect(screen.queryByText('整段译文。')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('does not leak source text when only translation is requested but unavailable', () => {
    render(surface({ source: paragraph, content: { paragraph: { original: false, translation: true, translationView: 'sentences' } } }));
    expect(screen.queryByText(paragraph.text)).toBeNull();
    expect(screen.getByText('暂无整段译文，请先运行整体翻译。')).toBeTruthy();
  });
  it('uses a PDF crop if the original asset fails, without silently showing the parsed diagram', async () => {
    const pdf = {} as PDFDocumentProxy;
    let resolve!: (url: string | null) => void;
    vi.mocked(readCachedPdfSegmentSnapshot).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<ReflowContentLayers segment={{ ...image, bbox: [0, 0, 500, 500] }} content={resolveReflowContent('figure', 'source')}
      relatedImagePath={image.asset_path!} entryId="e" workspaceRoot="w" pdfDocument={pdf} onRequirePdfDocument={noop}
      size="standard" imageDetailEnabled={false} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('正在载入原文截图…')).toBeTruthy();
    await act(async () => resolve('data:image/png;base64,crop'));
    expect(screen.getByRole('img', { name: 'PDF 原文截图' }).getAttribute('src')).toBe('data:image/png;base64,crop');
    expect(screen.queryByText(/graph TD/)).toBeNull();
  });
  it('reports unavailable originals and keeps parsed content opt-in', () => {
    render(surface({ source: { ...image, asset_path: null } }));
    expect(screen.getByText('原图暂不可用。可右键开启解析内容。')).toBeTruthy();
    expect(screen.queryByText(/graph TD/)).toBeNull();
    openMenu(); fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示解析后内容' }));
    expect(within(document.querySelector('[aria-label="片段解析后内容"]')!).getByText(/graph TD/)).toBeTruthy();
  });
  it('can retry an unreadable asset without enabling parsed content', () => {
    render(surface());
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试原图' }));
    expect(screen.getByRole('img', { name: '片段原图' })).toBeTruthy();
    expect(screen.queryByText(/graph TD/)).toBeNull();
  });
  it.each([[true, true], [true, false], [false, true], [false, false]])('paragraph image=%s and parsed=%s are independent of the translation', (imageShown, parsedShown) => {
    render(surface({ source: { ...paragraph, asset_path: image.asset_path }, content: { paragraph: { image: imageShown, parsed: parsedShown, translation: true } }, translations: translatedParagraph('完整翻译。') }));
    expect(Boolean(screen.queryByRole('img', { name: '片段原图' }))).toBe(imageShown);
    expect(Boolean(screen.queryByText(paragraph.text))).toBe(parsedShown);
    expect(screen.getByText('完整翻译。')).toBeTruthy();
    expect(translate).not.toHaveBeenCalled();
  });
  it('right-click toggles the paragraph image and parsed layer without changing the translation', () => {
    render(surface({ source: { ...paragraph, asset_path: image.asset_path }, content: { paragraph: { translation: true } }, translations: translatedParagraph('完整翻译。') }));
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示原图' }));
    expect(screen.getByRole('img', { name: '片段原图' })).toBeTruthy();
    expect(screen.getByText(paragraph.text)).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '显示解析后内容' }));
    expect(screen.getByRole('img', { name: '片段原图' })).toBeTruthy();
    expect(screen.queryByText(paragraph.text)).toBeNull();
    expect(screen.getByText('完整翻译。')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu('p1');
    expect(screen.getByRole('menuitemcheckbox', { name: '显示翻译' }).getAttribute('aria-checked')).toBe('true');
    expect(translate).not.toHaveBeenCalled();
  });
  it('starting translation preserves an image-only segment display', () => {
    render(surface({ source: { ...paragraph, asset_path: image.asset_path }, content: { paragraph: { image: true, parsed: false } } }));
    openMenu('p1');
    fireEvent.click(screen.getByRole('menuitem', { name: 'AI 翻译此段' }));
    expect(translate).toHaveBeenCalledExactlyOnceWith('p1', false);
    expect(screen.getByRole('img', { name: '片段原图' })).toBeTruthy();
    expect(screen.queryByText(paragraph.text)).toBeNull();
    openMenu('p1');
    expect(screen.getByRole('menuitemcheckbox', { name: '显示原图' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: '显示解析后内容' }).getAttribute('aria-checked')).toBe('false');
  });
});
