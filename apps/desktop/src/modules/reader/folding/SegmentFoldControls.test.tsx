// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import { ReflowSegmentGroupView } from '../components/reflow/ReflowSegmentGroupView';
import { buildReflowSegmentGroups } from '../components/reflow/buildReflowBlocks';
import type { SourceSegment } from '@/shared/types/domain';
import { FoldReaderProvider } from './FoldReaderContext';
import type { FoldReader } from './useFoldReader';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType = 'mouse'; });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals(); });

function setup(options: { level?: 'key' | 'off' | 'full'; paragraph?: boolean; eligible?: boolean; short?: boolean; cached?: boolean } = {}) {
  const segment: SourceSegment = { uid: 'paragraph-1', page_idx: 0, text: options.short ? 'A short paragraph.' : `Original source paragraph ${Array(37).fill('context').join(' ')}.`, markdown: null, bbox: null,
    segment_type: options.paragraph === false ? 'heading' : 'paragraph', ...(options.eligible === false ? { continuation_group_id: 'continued' } : {}) };
  const records = options.cached ? { [segment.uid]: { segment_uid: segment.uid, source: segment.text, evidence: [0], brief: [segment.text],
    key: segment.text, takeaway: segment.text, topic: options.short ? 'short' : 'Original source', model: 'test', generated_at: '2026-01-01' } } : {};
  const fold = { level: options.level ?? 'key', overrides: {}, records, setOverride: vi.fn(), setLevel: vi.fn(), running: false } as unknown as FoldReader;
  const activate = vi.fn();
  const view = render(<TooltipProvider><ToastContext.Provider value={{ notify: () => 'toast', dismiss: vi.fn() }}>
    <FoldReaderProvider value={fold}><ReflowSegmentGroupView active={false} flashed={false} entryId="e" workspaceRoot={null}
      hoverPreviewEnabled={false} pdfDocument={null} reflowTranslationMode="source"
      segmentGroup={buildReflowSegmentGroups([segment])[0]} annotationsBySegmentUid={new Map()} notesBySegmentUid={new Map()}
      translationBySegmentUid={new Map()} sourceLinkCountBySegmentUid={new Map()} sourceBacklinksBySegmentUid={{}}
      onActivateSegment={activate} onOpenSegmentAnnotation={vi.fn()} onOpenSegmentNote={vi.fn()} onPreviewChange={vi.fn()}
      onRequirePdfDocument={vi.fn()} onHideSegment={vi.fn()} onCopyContent={vi.fn()} onCopySourceLink={vi.fn()} onOpenSourceBacklink={vi.fn()} />
    </FoldReaderProvider></ToastContext.Provider></TooltipProvider>);
  const section = view.container.querySelector('section')!;
  return { ...view, fold, activate, section };
}

it('keeps direct controls in the paragraph metadata row without triggering navigation', () => {
  const { fold, activate, section } = setup();
  const tabs = screen.getByRole('radiogroup', { name: '本段阅读详略' });
  expect(tabs.parentElement?.classList.contains('reflow-segment-fold-tabs')).toBe(true);
  expect(tabs.closest('.reflow-segment-metadata')?.textContent).toContain('第 1 页');
  expect(tabs.closest('section')).toBe(section);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByRole('radio', { name: '跟随全局' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.pointerMove(screen.getByRole('radio', { name: '结论' }), { pointerType: 'mouse' });
  expect(screen.getByRole('tooltip').textContent).toContain('本段尚未生成阅读详略，当前显示原文');
  fireEvent.click(screen.getByRole('radio', { name: '主题' }));
  expect(fold.setOverride).toHaveBeenLastCalledWith('paragraph-1', 'topic');
  fireEvent.click(screen.getByRole('radio', { name: '原文' }));
  expect(fold.setOverride).toHaveBeenLastCalledWith('paragraph-1', 'full');
  expect(fold.setLevel).not.toHaveBeenCalled();
  expect(activate).not.toHaveBeenCalled();
});

it('supports keyboard navigation and Escape back to the paragraph without activating it', async () => {
  const { section, activate } = setup();
  const inherit = screen.getByRole('radio', { name: '跟随全局' });
  act(() => inherit.focus());
  expect(screen.getByRole('tooltip').textContent).toContain('选择本段后生成');
  fireEvent.keyDown(inherit, { key: 'ArrowRight' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: '原文' })));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(document.activeElement).toBe(section);
  expect(activate).not.toHaveBeenCalled();
});

it('leaves native scrolling and text selection intact without creating an overlay', () => {
  const { section, activate } = setup();
  expect(fireEvent.wheel(section, { deltaY: 100 })).toBe(true);
  const source = section.querySelector('[data-reading-selection-source]')!;
  const range = document.createRange(); range.selectNodeContents(source);
  act(() => { window.getSelection()?.addRange(range); fireEvent(document, new Event('selectionchange')); });
  fireEvent.click(source);
  fireEvent.pointerMove(section, { buttons: 1 });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(activate).not.toHaveBeenCalled();
});

it('keeps controls independent from Ctrl pointer gestures on the paragraph', () => {
  const { activate } = setup();
  const full = screen.getByRole('radio', { name: '原文' });
  fireEvent.pointerDown(full, { button: 0, buttons: 1, ctrlKey: true });
  fireEvent.pointerUp(full);
  fireEvent.click(full, { ctrlKey: true });
  expect(activate).not.toHaveBeenCalled();
});

it('routes Ctrl+wheel and Ctrl+arrows to the paragraph override without global changes or navigation', () => {
  const { fold, activate, section } = setup({ cached: true });
  expect(fireEvent.wheel(section, { ctrlKey: true, deltaY: 100, cancelable: true })).toBe(false);
  expect(fold.setOverride).toHaveBeenLastCalledWith('paragraph-1', 'takeaway');
  fireEvent.keyDown(section, { ctrlKey: true, key: 'ArrowUp' });
  expect(fold.setOverride).toHaveBeenLastCalledWith('paragraph-1', 'brief');
  expect(fold.setLevel).not.toHaveBeenCalled();
  expect(activate).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: '主题' }).getAttribute('aria-description')).toContain('Ctrl + 滚轮');
});

it.each([{}, { level: 'off' as const, cached: true }, { eligible: false, cached: true }, { paragraph: false, cached: true }])(
  'does not claim Ctrl+wheel without usable active folding: %o', options => {
    const { fold, section } = setup(options);
    expect(fireEvent.wheel(section, { ctrlKey: true, deltaY: 100, cancelable: true })).toBe(true);
    expect(fold.setOverride).not.toHaveBeenCalled();
  }
);

it('preserves unsupported paragraphs and leaves only full text and inheritance available', () => {
  setup({ eligible: false });
  expect((screen.getByRole('radio', { name: '精简' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('radio', { name: '原文' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('radio', { name: '跟随全局' }) as HTMLButtonElement).disabled).toBe(false);
});

it('keeps short paragraphs unchanged unless an earlier result already exists', () => {
  const first = setup({ short: true });
  expect(screen.getByText('此段较短，保留原文。')).toBeTruthy();
  expect((screen.getByRole('radio', { name: '精简' }) as HTMLButtonElement).disabled).toBe(true);
  first.unmount();
  setup({ short: true, cached: true });
  expect(screen.queryByText('此段较短，保留原文。')).toBeNull();
  expect((screen.getByRole('radio', { name: '精简' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('button', { name: '重新生成本段' })).toBeNull();
});

it.each([{ level: 'off' as const }, { paragraph: false }])('does not show paragraph controls when unavailable: %o', options => {
  setup(options);
  expect(screen.queryByRole('radiogroup', { name: '本段阅读详略' })).toBeNull();
});

it('keeps the default original view quiet before results exist', () => {
  setup({ level: 'full' });
  expect(screen.getByRole('radio', { name: '原文' })).toBeTruthy();
  expect(screen.queryByText('此段暂无详略，显示完整原文。')).toBeNull();
  expect(screen.queryByRole('button', { name: '生成本段' })).toBeNull();
});
