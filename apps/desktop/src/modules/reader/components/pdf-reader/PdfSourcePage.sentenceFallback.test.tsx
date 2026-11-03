// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { SourceSegment } from '@/shared/types/domain';
import { groupSegmentsByPage } from './readerUtils';

vi.mock('./PdfCanvasPage', () => ({
  PdfCanvasPage: () => <div />,
  PdfTextSelectionHighlightLayer: () => null,
}));
import { PdfSourcePage } from './PdfSourcePage';

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

function setup({ text = sourceText, translated = paragraphText, geometry = true, ...overrides }:
  Partial<Props> & { text?: string; translated?: string; geometry?: boolean } = {}) {
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
  const ui = render(<PdfSourcePage {...props} />);
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
    expect(ui.queryByRole('region', { name: 'PDF 整句悬停预览' })).toBeNull();
    expect(preview.textContent).not.toContain(sourceText);
    expect(ui.props.onToggleSegment).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'paragraph translation', hoverPreviewShowTranslation: false },
    { label: 'paragraph hover', hoverPreviewEnabled: false },
    { label: 'sentence translation', sentenceHoverShowTranslation: false },
    { label: 'translation visibility', translationVisible: false },
  ])('does not fall back when $label is disabled', ({ label: _, ...settings }) => {
    const ui = setup({ ...settings, sentenceHoverShowOriginal: true });
    ui.hover();
    expect(ui.queryByText(notice)).toBeNull();
    expect(ui.queryByText(paragraphText)).toBeNull();
    expect(ui.getByRole('region', { name: 'PDF 整句悬停预览' }).textContent).toContain('The model predicts future traffic.');
  });

  it.each(['', '   '])('does not claim a fallback when no paragraph translation exists (%j)', translated => {
    const ui = setup({ translated });
    ui.hover();
    expect(ui.queryByText(notice)).toBeNull();
    expect(ui.queryByRole('region')).toBeNull();
  });

  it('returns to sentence translation when the saved result becomes alignable, without changing preferences', () => {
    const ui = setup();
    ui.hover();
    expect(ui.getByText(notice)).toBeTruthy();
    ui.update({ translationBySegmentUid: translationMap(ui.source, alignedText) });
    expect(ui.queryByText(notice)).toBeNull();
    expect(ui.queryByRole('region', { name: '片段悬停预览' })).toBeNull();
    const preview = ui.getByRole('region', { name: 'PDF 整句悬停预览' });
    expect(preview.textContent).toBe('模型预测未来交通流量。');
    expect(ui.props.hoverPreviewShowTranslation).toBe(true);
    expect(ui.props.sentenceHoverShowTranslation).toBe(true);
  });

  it('hits the visible Chinese sentence after switching from original PDF text to translation', () => {
    const ui = setup({ translated: alignedText, sentenceHoverShowOriginal: true });
    ui.hover(100, 70);
    expect(ui.getByRole('region', { name: 'PDF 整句悬停预览' }).textContent).toContain('The model predicts future traffic.');
    ui.update({ translationMode: 'replace' });
    expect(ui.queryByRole('region', { name: 'PDF 整句悬停预览' })).toBeNull();
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
    const preview = ui.getByRole('region', { name: 'PDF 整句悬停预览' });
    expect(preview.textContent).toContain('The model predicts future traffic.');
    expect(preview.textContent).toContain('模型预测未来交通流量。');
    expect(ui.container.querySelector('[data-pdf-hover-sentence="1"]')).toBeTruthy();
    ui.hover(100, 40);
    expect(ui.queryByRole('region', { name: 'PDF 整句悬停预览' })).toBeNull();
    rendered.textContent = '无法对应的译文';
    ui.hover(100, 70);
    expect(ui.queryByRole('region', { name: 'PDF 整句悬停预览' })).toBeNull();
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
    expect(ui.queryByRole('region')).toBeNull();
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
    expect(ui.getByRole('region', { name: 'PDF 整句悬停预览' })).toBeTruthy();
    expect(ui.queryByText(notice)).toBeNull();
  });
});
