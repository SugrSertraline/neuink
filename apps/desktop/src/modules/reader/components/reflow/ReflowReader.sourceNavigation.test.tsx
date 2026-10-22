// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_REFLOW_COMPONENT_PREFERENCES } from '@/shared/lib/readerPreferences';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReflowReader } from './ReflowReader';

const navigation = vi.hoisted(() => ({
  navigate: vi.fn(() => true), markJumpHandled: vi.fn(), isJumpHandled: vi.fn(() => false), notify: vi.fn()
}));
const virtualizerMeasure = vi.hoisted(() => vi.fn());
const virtualizerMeasureElement = vi.hoisted(() => vi.fn());
vi.mock('../navigation/useReflowReadingNavigation', () => ({ useReflowReadingNavigation: () => navigation }));
vi.mock('../pdf-reader/useReadingActivityTracker', () => ({ useReadingActivityTracker: () => null }));
vi.mock('../pdf-reader/SegmentRail', () => ({ SegmentRail: () => null }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: navigation.notify, dismiss: vi.fn() }) }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({
  measure: virtualizerMeasure, measureElement: virtualizerMeasureElement, getVirtualItems: () => [], getTotalSize: () => 0, scrollToIndex: vi.fn()
}) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function props(): ComponentProps<typeof ReflowReader> {
  return {
    entryId: 'e', workspaceRoot: null, activeSegmentUid: null, flashSegmentUid: null,
    annotationsBySegmentUid: new Map(), notesBySegmentUid: new Map(), sourceBacklinksBySegmentUid: {},
    sourceLinkCountBySegmentUid: new Map(), translationBySegmentUid: new Map(), hiddenSegmentUids: new Set(),
    pdfDocument: null, reflowBackgroundColor: '#fff', reflowFontSize: 16, reflowTranslationMode: 'source',
    reflowComponents: DEFAULT_REFLOW_COMPONENT_PREFERENCES,
    hoverPreviewEnabled: false, hoverPreviewShowOriginal: false, hoverPreviewShowTranslation: false,
    hoverPreviewShowAnnotation: false, hoverPreviewShowNote: false,
    segments: [{ uid: 's', page_idx: 2, text: 'Source', markdown: null, bbox: null, segment_type: 'paragraph' }],
    onActivateSegment: vi.fn(), onCopyContent: vi.fn(), onCopySourceLink: vi.fn(), onHideSegment: vi.fn(),
    onOpenSegmentAnnotation: vi.fn(), onOpenSegmentNote: vi.fn(), onOpenSourceBacklink: vi.fn(), onRequirePdfDocument: vi.fn()
  };
}

it('marks source jumps local and keeps note focus while retaining ordinary linked navigation', () => {
  const base = props();
  const ui = render(<ReflowReader {...base} scrollToSegmentUid="s" scrollRequestKey={1} localScrollRequest />, { wrapper: TooltipProvider });
  expect(navigation.markJumpHandled).toHaveBeenCalledWith('e:s:1', { localOnly: true });
  expect(navigation.navigate).toHaveBeenCalledWith({ pageIdx: 2, segmentUid: 's', focus: false }, { localOnly: true });
  navigation.navigate.mockClear();
  ui.rerender(<ReflowReader {...base} scrollToSegmentUid="s" scrollRequestKey={2} />);
  expect(navigation.navigate).toHaveBeenCalledWith({ pageIdx: 2, segmentUid: 's' }, { localOnly: false });
});

it('scrolls to the linked sentence after its paragraph is available', () => {
  vi.useFakeTimers();
  const base = props();
  const ui = render(<ReflowReader {...base} />, { wrapper: TooltipProvider });
  const scroll = ui.container.querySelector('.overflow-y-auto') as HTMLElement;
  const target = document.createElement('div');
  target.dataset.readingSegmentUid = 's';
  target.dataset.readingSentenceIndex = '1';
  scroll.append(target);
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 });
  scroll.getBoundingClientRect = () => new DOMRect(0, 100, 500, 600);
  target.getBoundingClientRect = () => new DOMRect(0, 450, 500, 30);
  scroll.scrollTo = vi.fn();
  ui.rerender(<ReflowReader {...base} scrollToSegmentUid="s" scrollRequestKey={4} scrollSentenceIndex={1} localScrollRequest />);
  act(() => vi.advanceTimersByTime(1));
  expect(scroll.scrollTo).toHaveBeenCalledWith({ top: 150, behavior: 'smooth' });
});

it('remeasures bilingual rows when the split reading width changes', () => {
  let notifyResize: ResizeObserverCallback | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
  const base = props();
  const ui = render(<ReflowReader {...base} reflowTranslationMode="bilingual" />, { wrapper: TooltipProvider });
  const surface = ui.container.querySelector('.reflow-reading-surface') as HTMLElement;
  expect(surface).toBeTruthy();
  const visibleRow = document.createElement('div');
  visibleRow.setAttribute('data-reflow-virtual-item', '');
  surface.appendChild(visibleRow);
  const notifyWidth = (width: number) => notifyResize?.([{
    contentRect: { width } as DOMRectReadOnly,
    target: surface,
  } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  virtualizerMeasure.mockClear();
  virtualizerMeasureElement.mockClear();
  notifyWidth(700);
  expect(virtualizerMeasure).not.toHaveBeenCalled();
  notifyWidth(0);
  notifyWidth(700);
  expect(virtualizerMeasure).not.toHaveBeenCalled();
  notifyWidth(420);
  expect(virtualizerMeasure).toHaveBeenCalledOnce();
  expect(virtualizerMeasureElement).toHaveBeenCalledExactlyOnceWith(visibleRow);
});

it('waits for loaded reflow content and ignores a previously handled request', () => {
  const base = props();
  const ui = render(<ReflowReader {...base} segments={[]} scrollToSegmentUid="s" scrollRequestKey={1} localScrollRequest />, { wrapper: TooltipProvider });
  expect(navigation.navigate).not.toHaveBeenCalled();
  ui.rerender(<ReflowReader {...base} scrollToSegmentUid="s" scrollRequestKey={1} localScrollRequest />);
  expect(navigation.navigate).toHaveBeenCalledOnce();
  navigation.isJumpHandled.mockReturnValue(true);
  ui.rerender(<ReflowReader {...base} scrollToSegmentUid="s" scrollRequestKey={1} localScrollRequest />);
  expect(navigation.navigate).toHaveBeenCalledOnce();
  navigation.isJumpHandled.mockReturnValue(false);
});

it('locates page-only sources at visible body content rather than a parsed page header', () => {
  const base = props();
  const segments = [{ ...base.segments[0], uid: 'header', segment_type: 'page_header' as const }, ...base.segments];
  render(<ReflowReader {...base} segments={segments}
    jumpRequest={{ kind: 'page', pageIdx: 2, requestKey: 10, targetSurfaceKey: 'reflow:e' }} />, { wrapper: TooltipProvider });
  expect(navigation.navigate).toHaveBeenCalledWith({ pageIdx: 2, segmentUid: 's', focus: false }, { localOnly: true });
  expect(navigation.notify).not.toHaveBeenCalled();
});

it.each(['hidden-segment', 'hidden-component'] as const)('falls back to visible same-page content for a %s source without changing preferences', reason => {
  const base = props();
  const segments = [{ ...base.segments[0], uid: 'figure', segment_type: 'figure' as const }, ...base.segments];
  const hidden = new Set(reason === 'hidden-segment' ? ['figure'] : []);
  const components = { ...base.reflowComponents, figure: { ...base.reflowComponents.figure, visible: reason !== 'hidden-component' } };
  render(<ReflowReader {...base} segments={segments} hiddenSegmentUids={hidden} reflowComponents={components}
    jumpRequest={{ kind: 'segment', segmentUid: 'figure', pageIdx: 2, requestKey: 11, targetSurfaceKey: 'reflow:e:view:copy' }} />, { wrapper: TooltipProvider });
  expect(navigation.navigate).toHaveBeenCalledWith({ pageIdx: 2, segmentUid: 's', focus: false }, { localOnly: true });
  expect(hidden.has('figure')).toBe(reason === 'hidden-segment');
  expect(components.figure.visible).toBe(reason !== 'hidden-component');
  expect(navigation.notify).not.toHaveBeenCalled();
});

it('reports an entirely hidden page once without scrolling elsewhere, and permits a retry after content is restored', () => {
  const base = props();
  const request = { kind: 'page' as const, pageIdx: 2, requestKey: 12, targetSurfaceKey: 'reflow:e' };
  const hidden = new Set(['s']);
  const ui = render(<ReflowReader {...base} hiddenSegmentUids={hidden} jumpRequest={request} />, { wrapper: TooltipProvider });
  ui.rerender(<ReflowReader {...base} hiddenSegmentUids={hidden} jumpRequest={request} />);
  expect(navigation.navigate).not.toHaveBeenCalled();
  expect(navigation.markJumpHandled).not.toHaveBeenCalled();
  expect(navigation.notify).toHaveBeenCalledOnce();
  expect(navigation.notify).toHaveBeenCalledWith(expect.objectContaining({ title: '第 3 页没有可定位的重排内容' }));
  ui.rerender(<ReflowReader {...base} jumpRequest={request} />);
  expect(navigation.navigate).toHaveBeenCalledWith({ pageIdx: 2, segmentUid: 's', focus: false }, { localOnly: true });
});
