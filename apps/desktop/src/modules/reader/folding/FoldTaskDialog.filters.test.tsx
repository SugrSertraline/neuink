// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SourceSegment } from '@/shared/types/domain';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
import { FoldTaskDialog } from './FoldTaskDialog';
import type { FoldReader } from './useFoldReader';
import type { FoldTaskSnapshot } from './foldTasks';

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerType = 'mouse'; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const segments: SourceSegment[] = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, index) => ({
  uid: name, segment_type: 'paragraph', page_idx: Math.floor(index / 2), bbox: null, markdown: null,
  text: `${name} ${Array(19).fill('content').join(' ')}.`
}));
const saved: FoldRecord = { segment_uid: 'Alpha', source: segments[0].text, evidence: [0], brief: [segments[0].text],
  key: 'Saved finding.', takeaway: 'Saved finding.', topic: 'Saved', model: 'test', generated_at: '' };
const task: FoldTaskSnapshot = { status: 'failed', force: false, segments: segments.slice(0, 3),
  progress: { phase: 'preparing', total: 3, completed: 1, failed: 1, activeSegmentUids: [], completedSegmentUids: ['Alpha'],
    failedSegmentUids: ['Beta'], canceledSegmentUids: ['Gamma'], cachedSegmentUids: [], segmentErrors: { Beta: '输出不完整，请重试。' } } };
function setup(overrides: Partial<FoldReader> = {}) {
  const fold = { root: 'test', entryId: 'paper', ready: true, loadState: 'ready', segments, records: { Alpha: saved },
    task, start: vi.fn(), cancelSegments: vi.fn(), ...overrides } as unknown as FoldReader;
  const fixture = (value: FoldReader) => <TooltipProvider><FoldTaskDialog open fold={value} onOpenChange={vi.fn()} /></TooltipProvider>;
  const view = render(fixture(fold));
  return { ...view, fold, update: (value: Partial<FoldReader>) => view.rerender(fixture({ ...fold, ...value })) };
}

it('selects only the filtered rows and retains hidden selections explicitly', () => {
  const view = setup();
  fireEvent.click(view.getByRole('button', { name: '失败 1' }));
  expect(view.getAllByRole('checkbox')).toHaveLength(2);
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '待生成 1' }));
  expect(view.getByText(/筛选外已选 1 段/)).toBeTruthy();
  expect(view.getByRole('checkbox', { name: '全选当前列表' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（2）' }));
  expect(view.fold.start).toHaveBeenLastCalledWith([segments[1], segments[3]], false);
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（1）' }));
  expect(view.fold.start).toHaveBeenLastCalledWith([segments[1]], false);
  fireEvent.click(view.getByRole('button', { name: '清空选择' }));
  expect(view.getByRole('button', { name: '开始生成（0）' })).toHaveProperty('disabled', true);
});

it('combines page, source search and state filters without selecting or starting work', () => {
  const view = setup();
  fireEvent.keyDown(view.getByRole('combobox', { name: '筛选页码' }), { key: 'Enter' });
  fireEvent.click(view.getByRole('option', { name: '第 2 页' }));
  expect(view.getByRole('button', { name: '全部 2' })).toBeTruthy();
  expect(view.getByRole('checkbox', { name: '选择第 2 页第 4 段' })).toBeTruthy();
  fireEvent.change(view.getByRole('textbox', { name: '搜索正文' }), { target: { value: 'dElTa' } });
  expect(view.getByRole('button', { name: '全部 1' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '选择未生成' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（1）' }));
  expect(view.fold.start).toHaveBeenLastCalledWith([segments[3]], false);
  fireEvent.click(view.getByRole('button', { name: '失败 0' }));
  expect(view.getByText(/当前筛选下没有段落/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '重置筛选' }));
  expect(view.getAllByRole('checkbox')).toHaveLength(5);
  expect(view.fold.start).toHaveBeenCalledTimes(1);
});

it('filters live processing separately and never cancels a saving row', () => {
  const current: FoldTaskSnapshot = { ...task, status: 'running', segments, progress: { ...task.progress,
    total: 4, completed: 0, failed: 0, completedSegmentUids: [], failedSegmentUids: [], canceledSegmentUids: [], segmentErrors: {},
    activeSegmentUids: ['Alpha', 'Beta'], savingSegmentUids: ['Beta'] } };
  const view = setup({ task: current, records: {} });
  fireEvent.click(view.getByRole('button', { name: '处理中 2' }));
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '取消所选（1）' }));
  expect(view.fold.cancelSegments).toHaveBeenCalledWith(['Alpha']);
  view.update({ records: {}, task: { ...current, progress: { ...current.progress, activeSegmentUids: [], savingSegmentUids: [],
    completed: 2, completedSegmentUids: ['Alpha', 'Beta'] } } });
  expect(view.getByText(/当前筛选下没有段落/)).toBeTruthy();
  expect(view.getByRole('button', { name: '已有结果 2' })).toBeTruthy();
  expect(view.getByText(/筛选外已选 2 段/)).toBeTruthy();
});

it('opens a complete cached preview on hover without selecting or generating', async () => {
  const view = setup();
  const eye = view.getByRole('button', { name: '查看第 1 页第 1 段详情' });
  fireEvent.pointerMove(eye, { pointerType: 'mouse' });
  const preview = await waitFor(() => view.getByRole('region', { name: '段落详情' }));
  expect(within(within(preview).getByText('完整原文').parentElement!).getByText(segments[0].text)).toBeTruthy();
  expect(within(preview).getByText('已保存详略')).toBeTruthy();
  expect(within(preview).getByText('Saved')).toBeTruthy();
  expect(view.getByRole('checkbox', { name: '选择第 1 页第 1 段' }).getAttribute('aria-checked')).toBe('false');
  expect(view.fold.start).not.toHaveBeenCalled();
});

it('opens failure details by keyboard focus and stale cache never appears as a current result', async () => {
  const view = setup({ records: { Beta: { ...saved, segment_uid: 'Beta' } } });
  fireEvent.focus(view.getByRole('button', { name: '查看第 1 页第 2 段详情' }));
  const preview = await waitFor(() => view.getByRole('region', { name: '段落详情' }));
  expect(within(preview).getByText('输出不完整，请重试。')).toBeTruthy();
  expect(within(preview).queryByText('已保存详略')).toBeNull();
  expect(within(preview).getByText(segments[1].text)).toBeTruthy();
});

it('resets filters and selections when changing entries', () => {
  const view = setup();
  fireEvent.change(view.getByRole('textbox', { name: '搜索正文' }), { target: { value: 'Alpha' } });
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  view.update({ entryId: 'another' });
  expect(view.getAllByRole('checkbox')).toHaveLength(5);
  expect(view.getByRole('textbox', { name: '搜索正文' })).toHaveProperty('value', '');
  expect(view.getByRole('button', { name: '开始生成（0）' })).toHaveProperty('disabled', true);
});
