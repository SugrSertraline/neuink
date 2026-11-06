// @vitest-environment jsdom
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { SourceSegment } from '@/shared/types/domain';
import { groupSegmentsByPage } from './readerUtils';

vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('./PdfCanvasPage', () => ({
  PdfCanvasPage: () => <div />,
  PdfTextSelectionHighlightLayer: () => null,
}));
import { PdfSourcePage } from './PdfSourcePage';
import { PdfViewControls, ReadingViewSession } from '../navigation/ReadingViewSession';
import { usePdfTranslationController } from './usePdfTranslationController';
vi.mock('../../translation/useEntryTranslationTask', () => ({ useEntryTranslationTask: () => ({ translation: null }) }));
function SessionPage(props: Props) {
  const { translationMode, visible } = usePdfTranslationController({ entryId: 'entry', entryTitle: 'Paper',
    loadReady: true, onExportTranslationNote: async () => undefined, segments: [], workspaceRoot: null });
  return <><PdfViewControls /><PdfSourcePage {...props} translationMode={translationMode} translationVisible={visible} /></>;
}

const sourceText = 'Traffic flow changes rapidly. The model predicts future traffic.';
const paragraphText = '交通流量变化及未来预测。';
const alignedText = '交通流量迅速变化。模型预测未来交通流量。';
const notice = '逐句译文暂不可用，已显示整段译文';
const noop = () => undefined;
type Props = ComponentProps<typeof PdfSourcePage>;
const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value(this: Range) {
    return [this.startContainer.parentElement!.getBoundingClientRect()] as unknown as DOMRectList;
  } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalClientRects);
  else delete (Range.prototype as { getClientRects?: () => DOMRectList }).getClientRects;
});

function translationMap(source: SourceSegment, text: string) {
  const translation: TranslatedSegment = { error: null, page_idx: 0, segment_type: 'paragraph',
    segment_uid: source.uid, source_hash: 'hash', source_text: source.text, status: 'translated',
    translated_text: text, updated_at: '' };
  return new Map([[source.uid, translation]]);
}

function setup({ text = sourceText, translated = paragraphText, geometry = true, session = false, ...overrides }:
  Partial<Props> & { text?: string; translated?: string; geometry?: boolean; session?: boolean } = {}) {
  const source: SourceSegment = { uid: 'paragraph', segment_type: 'paragraph', page_idx: 0,
    bbox: [10, 20, 650, 140], text, markdown: text };
  const props: Props = {
    page: groupSegmentsByPage([source], 1)[0], pageWidth: 800, pdfDocument: {} as PDFDocumentProxy,
    flashSegmentUid: null, hoveredSegmentUid: null, hoverPreviewEnabled: true, hoverPreviewShowRegion: false,
    hoverPreviewShowOriginal: false, hoverPreviewShowNote: false, hoverPreviewShowAnnotation: false,
    hoverPreviewShowTranslation: true, inlineAnnotationHoverEnabled: false, sentenceHoverEnabled: true,
    sentenceHoverShowOriginal: false, sentenceHoverShowTranslation: true, notesBySegmentUid: new Map(),
    annotationsBySegmentUid: new Map(), sourceBacklinksBySegmentUid: {}, sourceEntryId: 'entry', workspaceRoot: null,
    renderEnabled: false, renderPriority: 'visible', showRegions: false, suppressRegions: false,
    translationMode: 'hover', translationVisible: true, translationStatus: null,
    translationBySegmentUid: translationMap(source, translated),
    onCloseSegmentOverlay: noop, onOpenSegmentAnnotation: noop, onOpenSegmentNote: noop,
    onOpenSourceBacklink: noop, onToggleSegment: vi.fn(), ...overrides,
  };
  const ui = render(session ? <ReadingViewSession workspaceRoot={null} active surface={{ kind: 'pdf', entryId: 'entry' }}><SessionPage {...props} /></ReadingViewSession> : <PdfSourcePage {...props} />, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });
  const hit = ui.getByTestId('pdf-page-hit-layer-0');
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 1000));
  const layer = document.createElement('div');
  layer.className = 'pdf-text-layer';
  if (geometry) {
    ['Traffic flow changes rapidly. ', 'The model predicts future traffic.'].forEach((text, index) => {
      const span = document.createElement('span');
      span.textContent = text;
      vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30 + index * 30, 400, 20));
      layer.append(span);
    });
    hit.append(layer);
  }
  const hover = (x = 100, y = 70) => {
    fireEvent.pointerMove(hit, { buttons: 0, clientX: x, clientY: y });
    act(() => vi.advanceTimersByTime(20));
  };
  return { ...ui, hit, layer, source, props, hover,
    update: (next: Partial<Props>) => { Object.assign(props, next); ui.rerender(<PdfSourcePage {...props} />); },
  };
}

describe('PDF sentence translation fallback', () => {
  it('selects visible translated sentences and shows their original without an API request', async () => {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
      value() { return new DOMRect(20, 60, 400, 20); } });
    try {
      const translate = vi.fn();
      const ui = setup({ translationMode: 'replace', translated: alignedText,
        autoTranslateTextSelection: true, onTranslateTextSelection: translate });
      const layer = ui.hit.querySelector<HTMLElement>('[data-pdf-translation-region]')!;
      layer.innerHTML = '';
      ['交通流量迅速变化。', '模型预测未来交通流量。'].forEach((text, index) => {
        const span = document.createElement('span'); span.textContent = text;
        vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30 + index * 30, 400, 20));
        layer.append(span);
      });
      vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 640, 120));
      ui.hover(100, 70);
      const button = ui.getByRole('button', { name: '选中此句' });
      fireEvent.pointerDown(button, { button: 0 });
      fireEvent.pointerUp(button, { button: 0 });
      fireEvent.click(button);
      await act(async () => { vi.advanceTimersByTime(100); });
      expect(window.getSelection()?.toString()).toBe('模型预测未来交通流量。');
      const dialog = ui.getByRole('dialog', { name: '选区操作' });
      expect(within(dialog).getByText('The model predicts future traffic.')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: '查看原文' })).toBeTruthy();
      expect(within(dialog).queryByRole('button', { name: '仅高亮' })).toBeNull();
      expect(translate).not.toHaveBeenCalled();
      ui.hover(100, 40);
      expect(ui.getByRole('button', { name: '选中此句' })).toBeTruthy();
      // Native selection of a partial translated sentence uses the same lookup.
      fireEvent.pointerDown(layer.firstChild!, { button: 0, clientX: 100, clientY: 40 });
      const range = document.createRange();
      range.setStart(layer.firstChild!.firstChild!, 0); range.setEnd(layer.firstChild!.firstChild!, 4);
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
      fireEvent.pointerUp(layer.firstChild!, { button: 0, clientX: 150, clientY: 40 });
      await act(async () => { vi.advanceTimersByTime(100); });
      expect(within(ui.getByRole('dialog', { name: '选区操作' })).getByText('Traffic flow changes rapidly.')).toBeTruthy();
      expect(translate).not.toHaveBeenCalled();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(window.getSelection()?.toString()).toBe('');
      expect(ui.queryByRole('dialog', { name: '选区操作' })).toBeNull();
      layer.firstChild!.textContent = '无法逐句对应的译文';
      layer.lastChild!.remove();
      fireEvent.pointerDown(layer.firstChild!, { button: 0, clientX: 100, clientY: 40 });
      const fallbackRange = document.createRange(); fallbackRange.selectNodeContents(layer.firstChild!);
      window.getSelection()?.addRange(fallbackRange);
      fireEvent.pointerUp(layer.firstChild!, { button: 0, clientX: 150, clientY: 40 });
      await act(async () => { vi.advanceTimersByTime(100); });
      const fallbackDialog = ui.getByRole('dialog', { name: '选区操作' });
      expect(within(fallbackDialog).getByText('无法准确对应句子，已显示整段原文')).toBeTruthy();
      expect(within(fallbackDialog).getByText(sourceText)).toBeTruthy();
      expect(translate).not.toHaveBeenCalled();
    } finally {
      window.getSelection()?.removeAllRanges();
      delete (Range.prototype as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
    }
  });

  it('top controls update the translation controller and actual page in both directions', () => {
    const ui = setup({ session: true, translated: alignedText });
    expect(ui.hit.querySelector('[data-pdf-translation-region]')).toBeNull();
    fireEvent.click(ui.getByRole('button', { name: '译文' }));
    expect(ui.getByRole('button', { name: '译文' }).getAttribute('aria-pressed')).toBe('true');
    expect(ui.hit.querySelector('[data-pdf-translation-region]')?.textContent).toContain(alignedText);
    fireEvent.click(ui.getByRole('button', { name: '原文' }));
    expect(ui.hit.querySelector('[data-pdf-translation-region]')).toBeNull();
    expect(ui.getByRole('button', { name: '原文' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(ui.getByRole('button', { name: '译文' }));
    expect(ui.hit.querySelector('[data-pdf-translation-region]')?.textContent).toContain(alignedText);
  });

  it.each([false, true])('right-side button selects without opening notes (auto translate: %s)', async autoTranslateTextSelection => {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
      value() { return new DOMRect(20, 60, 400, 20); } });
    try {
      const ui = setup({ autoTranslateTextSelection, onTranslateTextSelection: vi.fn().mockResolvedValue('译文') });
      const span = ui.layer.children[1];
      ui.hover();
      expect(ui.getByText(/点击句子右上方按钮/)).toBeTruthy();
      const button = ui.getByRole('button', { name: '选中此句' });
      // Cross whitespace between text and button without losing the action.
      ui.hover(430, 70);
      fireEvent.pointerEnter(button);
      act(() => vi.advanceTimersByTime(200));
      fireEvent.pointerDown(button, { button: 0 });
      fireEvent.pointerUp(button, { button: 0 });
      fireEvent.click(button);
      await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); });
      expect(window.getSelection()?.toString()).toBe('The model predicts future traffic.');
      expect(ui.hit.querySelector('[data-pdf-sentence-focus]')).toBeTruthy();
      expect(ui.props.onToggleSegment).not.toHaveBeenCalled();
      expect(ui.props.onTranslateTextSelection).toHaveBeenCalledTimes(autoTranslateTextSelection ? 1 : 0);
      ui.hover(100, 40);
      expect(ui.hit.querySelector('[data-pdf-hover-sentence="0"]')).toBeTruthy();
      expect(ui.getByRole('button', { name: '选中此句' })).toBeTruthy();
      expect(ui.queryByRole('region', { name: '片段悬停预览' })).toBeNull();
      const nextButton = ui.getByRole('button', { name: '选中此句' });
      fireEvent.pointerDown(nextButton, { button: 0 });
      fireEvent.pointerUp(nextButton, { button: 0 });
      fireEvent.click(nextButton);
      await act(async () => { vi.advanceTimersByTime(100); await Promise.resolve(); });
      expect(window.getSelection()?.toString()).toBe('Traffic flow changes rapidly.');
      expect(ui.props.onToggleSegment).not.toHaveBeenCalled();
      expect(ui.props.onTranslateTextSelection).toHaveBeenCalledTimes(autoTranslateTextSelection ? 2 : 0);
      window.getSelection()?.removeAllRanges();
      ui.update({ sentenceHoverEnabled: false });
      fireEvent.pointerDown(span, { button: 0, clientX: 100, clientY: 70 });
      fireEvent.pointerUp(span, { button: 0, clientX: 100, clientY: 70 });
      fireEvent.click(span, { button: 0, detail: 1, clientX: 100, clientY: 70 });
      expect(ui.props.onToggleSegment).toHaveBeenCalledTimes(1);
      expect(ui.hit.querySelector('[data-pdf-sentence-focus]')).toBeNull();
      ui.update({ sentenceHoverEnabled: true });
      ui.hover(100, 40);
      expect(ui.hit.querySelector('[data-pdf-hover-sentence="0"]')).toBeTruthy();
    } finally {
      window.getSelection()?.removeAllRanges();
      delete (Range.prototype as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
    }
  });
  it.each([false, true])('keeps immediate single-click and native double-click (sentence mode: %s)', sentenceHoverEnabled => {
    const ui = setup({ sentenceHoverEnabled, onTranslateTextSelection: vi.fn() });
    const span = ui.layer.children[1];
    fireEvent.pointerDown(span, { button: 0, clientX: 100, clientY: 70 });
    fireEvent.pointerUp(span, { button: 0, clientX: 100, clientY: 70 });
    fireEvent.click(span, { button: 0, detail: 1, clientX: 100, clientY: 70 });
    expect(ui.props.onToggleSegment).toHaveBeenCalledTimes(1);
    const word = document.createRange();
    word.getBoundingClientRect = () => new DOMRect(20, 60, 400, 20);
    word.setStart(span.firstChild!, 4);
    word.setEnd(span.firstChild!, 9);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(word);
    expect(fireEvent.doubleClick(span, { button: 0, clientX: 100, clientY: 70 })).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    expect(window.getSelection()?.toString()).toBe('model');
    window.getSelection()?.removeAllRanges();
    expect(ui.props.onTranslateTextSelection).not.toHaveBeenCalled();
    expect(ui.hit.querySelector('[data-pdf-sentence-focus]')).toBeNull();
  });
  it.each([
    { reason: 'unreliable translation sentence boundaries' },
    { reason: 'PDF text not matching the parsed paragraph', text: 'Road conditions vary quickly. Another algorithm predicts demand.', translated: alignedText },
    { reason: 'missing PDF text geometry', geometry: false },
  ])('shows the saved paragraph with a small notice for $reason', options => {
    const ui = setup(options);
    ui.hover();
    const preview = ui.getByRole('region', { name: '片段悬停预览' });
    expect(within(preview).getByText(options.translated ?? paragraphText)).toBeTruthy();
    expect(preview.firstElementChild?.textContent).toBe(notice);
    expect(preview.firstElementChild?.className).toContain('text-xs');
    expect(ui.getAllByRole('region', { name: '片段悬停预览' })).toHaveLength(1);
    expect(preview.textContent).not.toContain(sourceText);
    expect(ui.props.onToggleSegment).not.toHaveBeenCalled();
  });

  it('hides all previews when hover is disabled and preserves source visibility independently', () => {
    const ui = setup({ hoverPreviewEnabled: false, hoverPreviewShowOriginal: true, sentenceHoverShowOriginal: true });
    ui.hover();
    expect(ui.queryByRole('region')).toBeNull();
    ui.update({ hoverPreviewEnabled: true, hoverPreviewShowTranslation: false });
    ui.hover();
    expect(ui.queryByText(notice)).toBeNull();
    expect(ui.getByRole('region', { name: '片段悬停预览' }).textContent).toContain('The model predicts future traffic.');
    expect(ui.queryByText(paragraphText)).toBeNull();
  });

  it.each(['', '   '])('explains the paragraph fallback when no translation exists (%j)', translated => {
    const ui = setup({ translated });
    ui.hover();
    expect(ui.getByText('逐句译文暂不可用，已回退整段；本段尚无译文')).toBeTruthy();
  });

  it('returns to sentence translation when the saved result becomes alignable, without changing preferences', () => {
    const ui = setup();
    ui.hover();
    expect(ui.getByText(notice)).toBeTruthy();
    ui.update({ translationBySegmentUid: translationMap(ui.source, alignedText) });
    expect(ui.queryByText(notice)).toBeNull();
    const preview = ui.getByRole('region', { name: '片段悬停预览' });
    expect(preview.textContent).toContain('模型预测未来交通流量。');
    expect(preview.textContent).not.toContain('交通流量迅速变化。');
    expect(ui.props.hoverPreviewShowTranslation).toBe(true);
    expect(ui.props.sentenceHoverShowTranslation).toBe(true);
  });

  it('hits the visible Chinese sentence after switching from original PDF text to translation', () => {
    const ui = setup({ translated: alignedText, hoverPreviewShowOriginal: true, sentenceHoverShowOriginal: true });
    ui.hover(100, 70);
    expect(ui.getByRole('region', { name: '片段悬停预览' }).textContent).toContain('The model predicts future traffic.');
    ui.update({ translationMode: 'replace' });
    expect(ui.queryByRole('region', { name: '片段悬停预览' })).toBeNull();
    const rendered = ui.hit.querySelector<HTMLElement>('[data-pdf-translation-region]')!;
    rendered.innerHTML = '';
    ['交通流量迅速变化。', '模型预测未来交通流量。'].forEach((text, index) => {
      const span = document.createElement('span');
      span.textContent = text;
      vi.spyOn(span, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 80 + index * 30, 400, 20));
      rendered.append(span);
    });
    vi.spyOn(rendered, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 640, 120));
    ui.hover(100, 110);
    const preview = ui.getByRole('region', { name: '片段悬停预览' });
    expect(preview.textContent).toContain('The model predicts future traffic.');
    expect(preview.textContent).toContain('模型预测未来交通流量。');
    expect(ui.container.querySelector('[data-pdf-hover-sentence="1"]')).toBeTruthy();
    ui.hover(100, 40);
    expect(ui.queryByRole('region', { name: '片段悬停预览' })).toBeNull();
    rendered.textContent = '无法对应的译文';
    ui.hover(100, 70);
    expect(ui.getByRole('region', { name: '片段悬停预览' }).textContent).toContain('逐句译文暂不可用');
    expect(ui.container.querySelector('[data-pdf-hover-sentence]')).toBeNull();
  });

  it('reacts immediately to paragraph preferences and reuses paragraph typography', () => {
    const ui = setup();
    ui.hover();
    ui.update({ hoverPreviewShowOriginal: true, hoverPreviewFontSize: 150 });
    const preview = ui.getByRole('region', { name: '片段悬停预览' });
    expect(within(preview).getByText(sourceText)).toBeTruthy();
    const content = within(preview).getByText(paragraphText).closest('[style]') as HTMLElement;
    expect(content.style.fontSize).toBe('19.5px');
    ui.update({ hoverPreviewShowTranslation: false });
    expect(ui.queryByText(notice)).toBeNull();
    expect(ui.getByRole('region').textContent).toContain(sourceText);
    ui.update({ hoverPreviewShowTranslation: true });
    expect(ui.getByText(notice)).toBeTruthy();
  });

  it('keeps the fallback open when crossing to it and scrolling, then dismisses on exit or Escape', () => {
    const ui = setup();
    ui.hover();
    let preview = ui.getByRole('region', { name: '片段悬停预览' });
    ui.hover(100, 145);
    fireEvent.pointerEnter(preview);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.scroll(preview, { target: { scrollTop: 100 } });
    expect(ui.getByText(notice)).toBeTruthy();
    expect(preview.className).toContain('overflow-y-auto');
    fireEvent.click(preview);
    expect(ui.props.onToggleSegment).not.toHaveBeenCalled();
    fireEvent.keyDown(preview, { key: 'Escape' });
    expect(ui.queryByText(notice)).toBeNull();
    ui.hover();
    preview = ui.getByRole('region', { name: '片段悬停预览' });
    fireEvent.pointerLeave(ui.hit);
    fireEvent.pointerEnter(preview);
    act(() => vi.advanceTimersByTime(200));
    expect(ui.getByText(notice)).toBeTruthy();
    fireEvent.pointerLeave(preview);
    act(() => vi.advanceTimersByTime(200));
    expect(ui.queryByText(notice)).toBeNull();
  });

  it.each(['scroll', 'pointerdown', 'dragstart'])('dismisses the fallback during document %s', type => {
    const ui = setup();
    ui.hover();
    expect(ui.getByText(notice)).toBeTruthy();
    fireEvent(ui.hit, new Event(type, { bubbles: true }));
    expect(ui.queryByText(notice)).toBeNull();
  });

  it('suppresses fallback during resizing and does not fall back over gaps between valid sentences', () => {
    const ui = setup({ suppressRegions: true });
    ui.hover();
    expect(ui.queryByText(notice)).toBeNull();
    ui.update({ suppressRegions: false, translationBySegmentUid: translationMap(ui.source, alignedText) });
    ui.hover(100, 55);
    expect(ui.queryByRole('region')).toBeNull();
    ui.hover();
    expect(ui.getByRole('region', { name: '片段悬停预览' })).toBeTruthy();
    expect(ui.queryByText(notice)).toBeNull();
  });
});

it('shows paragraph source with sentence translation in the same preview', () => {
  const ui = setup({ translated: alignedText, hoverPreviewShowOriginal: true, sentenceHoverShowOriginal: false });
  ui.hover();
  const preview = ui.getByRole('region', { name: '片段悬停预览' });
  expect(preview.textContent).toContain(sourceText);
  expect(preview.textContent).toContain('模型预测未来交通流量。');
  expect(preview.textContent).not.toContain('交通流量迅速变化。');
});
it('shows sentence source with paragraph translation in the same preview', () => {
  const ui = setup({ translated: alignedText, hoverPreviewShowOriginal: true, sentenceHoverShowOriginal: true, sentenceHoverShowTranslation: false });
  ui.hover();
  const preview = ui.getByRole('region', { name: '片段悬停预览' });
  expect(preview.textContent).not.toContain('Traffic flow changes rapidly.');
  expect(preview.textContent).toContain('The model predicts future traffic.');
  expect(preview.textContent).toContain(alignedText);
});
it('explains original fallback when sentence geometry is missing', () => {
  const ui = setup({ geometry: false, hoverPreviewShowOriginal: true, sentenceHoverShowOriginal: true, hoverPreviewShowTranslation: false });
  ui.hover();
  expect(ui.getByText('逐句原文暂不可用，已显示整段原文')).toBeTruthy();
  expect(ui.getByRole('region').textContent).toContain(sourceText);
});
