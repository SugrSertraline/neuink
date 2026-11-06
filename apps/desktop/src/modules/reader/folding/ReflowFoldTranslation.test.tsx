// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { Annotation, SourceSegment } from '@/shared/types/domain';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
import { ReflowSegmentGroupView } from '../components/reflow/ReflowSegmentGroupView';
import { buildReflowSegmentGroups } from '../components/reflow/buildReflowBlocks';
import { FoldReaderProvider } from './FoldReaderContext';
import type { FoldReader, FoldLevel } from './useFoldReader';
import * as foldAlignment from './foldAlignment';

vi.mock('./FoldTranslationButton', () => ({ FoldTranslationButton: () => <button>生成当前详略译文</button> }));
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});
const noop = () => undefined;
const source = 'First claim. Supporting evidence.';
const segment: SourceSegment = { uid: 'p', segment_type: 'paragraph', page_idx: 0, bbox: null, text: source, markdown: null,
  raw_type: 'text', mineru_metadata: { level: '2' } };
const record: FoldRecord = { segment_uid: 'p', source, evidence: [0], brief: ['First claim.'], key: source,
  takeaway: 'First claim.', topic: 'First claim', model: 'model', generated_at: '2026', translations: {
    key: { source_text: source, translated_text: '完整的要点和依据。', model: 'model', generated_at: '2026' },
    takeaway: { source_text: 'First claim.', translated_text: '这是结论。', model: 'model', generated_at: '2026' }
  } };
const full: TranslatedSegment = { segment_uid: 'p', page_idx: 0, segment_type: 'paragraph', source_hash: 'fixture', source_text: source,
  translated_text: '这是全文译文。', status: 'translated', error: null, updated_at: '' };
const group = buildReflowSegmentGroups([segment])[0];
function fixture(level: FoldLevel, mode: 'source' | 'bilingual', value: FoldRecord = record, override?: FoldLevel) {
  const fold = { level, overrides: override ? { p: override } : {}, records: { p: value }, setOverride: noop, setLevel: noop, running: false, title: 'Paper' } as unknown as FoldReader;
  return <TooltipProvider><ToastContext.Provider value={{ notify: () => 'test', dismiss: noop }}><FoldReaderProvider value={fold}>
    <ReflowSegmentGroupView active={false} flashed={false} entryId="e" workspaceRoot="fixture" hoverPreviewEnabled={false} pdfDocument={null}
      reflowTranslationMode={mode} segmentGroup={group} annotationsBySegmentUid={new Map([['p', [{} as Annotation]]])} notesBySegmentUid={new Map()}
      translationBySegmentUid={new Map([['p', full]])} sourceLinkCountBySegmentUid={new Map()} sourceBacklinksBySegmentUid={{}}
      onActivateSegment={noop} onOpenSegmentAnnotation={noop} onOpenSegmentNote={noop} onPreviewChange={noop} onRequirePdfDocument={noop}
      onHideSegment={noop} onCopyContent={noop} onCopySourceLink={noop} onOpenSourceBacklink={noop} />
  </FoldReaderProvider></ToastContext.Provider></TooltipProvider>;
}

it('shows the matching Chinese level and never substitutes a stale or full translation', () => {
  const view = render(fixture('key', 'bilingual'));
  expect(screen.getByLabelText('中文译文').textContent).toBe('完整的要点和依据。');
  view.rerender(fixture('takeaway', 'bilingual'));
  expect(screen.getByLabelText('中文译文').textContent).toBe('这是结论。');
  view.rerender(fixture('topic', 'bilingual'));
  expect(screen.queryByText('这是全文译文。')).toBeNull();
  expect(screen.getByRole('button', { name: '生成当前详略译文' })).toBeTruthy();
  const stale = { ...record, translations: { key: { ...record.translations!.key, source_text: 'outdated' } } };
  view.rerender(fixture('key', 'bilingual', stale));
  expect(screen.queryByText('完整的要点和依据。')).toBeNull();
  expect(screen.getByRole('button', { name: '生成当前详略译文' })).toBeTruthy();
  view.rerender(fixture('full', 'bilingual'));
  expect(screen.getByText('这是全文译文。')).toBeTruthy();
  view.rerender(fixture('topic', 'source'));
  expect(screen.queryByRole('button', { name: '生成当前详略译文' })).toBeNull();
});

it('keeps Annotation and MinerU metadata in the right-side group without an AI badge', () => {
  const { container } = render(fixture('key', 'source'));
  const trailing = container.querySelector('[data-reflow-metadata-trailing]')!;
  expect(trailing.textContent).toContain('Annotation 1');
  expect(trailing.textContent).toContain('MinerU: text');
  expect(trailing.className).toContain('ml-auto');
  expect(container.querySelector('[data-slot="badge"]')?.parentElement?.textContent).not.toContain('AI 生成');
});

it('switches global source and Chinese levels without motion work, while local changes still animate and can be interrupted', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, finished: new Promise(() => {}) }) as unknown as Animation);
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const measurements = vi.fn();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-fold-token')) measurements();
    return { left: 0, top: 10, right: 500, bottom: 26, width: 500, height: 16, x: 0, y: 10, toJSON: () => ({}) } as DOMRect;
  });
  const align = vi.spyOn(foldAlignment, 'longestCommonFoldPairs');
  const view = render(fixture('key', 'bilingual'));
  align.mockClear(); measurements.mockClear();

  view.rerender(fixture('takeaway', 'bilingual'));
  expect(screen.getByLabelText('AI 生成').textContent).toBe('First claim.');
  expect(screen.getByLabelText('中文译文').textContent).toBe('这是结论。');
  expect(animate).not.toHaveBeenCalled();
  expect(measurements).not.toHaveBeenCalled();
  expect(align).not.toHaveBeenCalled();

  view.rerender(fixture('takeaway', 'bilingual', record, 'key'));
  expect(align).toHaveBeenCalled();
  expect(animate.mock.contexts.some(element => (element as Element).closest('[aria-label="AI 生成"]'))).toBe(true);
  expect(animate.mock.contexts.some(element => (element as Element).closest('[aria-label="中文译文"]'))).toBe(true);
  expect(document.querySelector('body > [aria-hidden="true"]')).toBeTruthy();

  animate.mockClear(); measurements.mockClear(); align.mockClear();
  view.rerender(fixture('brief', 'bilingual', record, 'key'));
  expect(screen.getByLabelText('AI 生成').textContent).toBe(source);
  expect(screen.getByLabelText('中文译文').textContent).toBe('完整的要点和依据。');
  expect(cancel).toHaveBeenCalled();
  expect(document.querySelector('body > [aria-hidden="true"]')).toBeNull();
  expect(animate).not.toHaveBeenCalled();
  expect(measurements).not.toHaveBeenCalled();
  expect(align).not.toHaveBeenCalled();
});
