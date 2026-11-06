// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { FoldTaskDialog as TaskDialog } from './FoldTaskDialog';
import type { FoldReader } from './useFoldReader';
import { TooltipProvider } from '@/components/ui/tooltip';

const paragraph = (uid: string): SourceSegment => ({ uid, segment_type: 'paragraph', page_idx: 0, bbox: null, text: `${uid} ${Array(39).fill('content').join(' ')}.`, markdown: null });
function FoldTaskDialog(props: React.ComponentProps<typeof TaskDialog>) {
  const fold = Object.assign({ root: 'root', entryId: 'paper', ready: true, loadState: 'ready', records: {},
    segments: props.fold.task?.segments ?? [] }, props.fold) as FoldReader;
  return <TooltipProvider><TaskDialog {...props} fold={fold} /></TooltipProvider>;
}
afterEach(cleanup);

it('requires explicit selection and start, excludes unsupported text, and supports partial/all selection', () => {
  const segments = [paragraph('a'), paragraph('b'), { ...paragraph('short'), text: 'Short.' }, { ...paragraph('title'), segment_type: 'heading' as const }];
  const start = vi.fn(), cancel = vi.fn(), close = vi.fn();
  const fold = { segments, start, cancel } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={close} fold={fold} />);
  expect(start).not.toHaveBeenCalled();
  expect(view.getAllByRole('checkbox')).toHaveLength(3);
  expect(view.getByRole('button', { name: '开始生成（0）' })).toHaveProperty('disabled', true);
  fireEvent.click(view.getByRole('checkbox', { name: '选择第 1 页第 2 段' }));
  expect(view.getByRole('checkbox', { name: '全选当前列表' }).getAttribute('aria-checked')).toBe('mixed');
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '开始生成（1）' }));
  expect(start).toHaveBeenLastCalledWith([segments[1]], false);
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（2）' }));
  expect(start).toHaveBeenLastCalledWith(segments.slice(0, 2), false);
  fireEvent.click(view.getByRole('button', { name: '关闭' }));
  expect(close).toHaveBeenCalledWith(false); expect(cancel).not.toHaveBeenCalled();
});

it('keeps unselected document paragraphs available after a partial task', () => {
  const segments = [paragraph('a'), paragraph('b')], start = vi.fn();
  const fold = { segments, start, task: { status: 'succeeded', segments: [segments[0]], force: false,
    progress: { phase: 'preparing', total: 1, completed: 1, failed: 0, activeSegmentUids: [],
      completedSegmentUids: ['a'], failedSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: [] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（1）' }));
  expect(start).toHaveBeenCalledExactlyOnceWith([segments[1]], false);
});

it('skips valid cached content before starting and keeps edited source eligible for generation', () => {
  const original = paragraph('a'), second = paragraph('b'), start = vi.fn();
  const fold = { segments: [original, second], start, records: { a: { segment_uid: 'a', source: original.text, evidence: [0],
    brief: [original.text], key: 'content', takeaway: 'content', topic: 'content', model: 'test', generated_at: '' } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  expect(view.getByText('已缓存')).toBeTruthy();
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（1）' }));
  expect(start).toHaveBeenLastCalledWith([second], false);
  const edited = { ...original, text: `${original.text} More context.` };
  view.rerender(<FoldTaskDialog open onOpenChange={vi.fn()} fold={{ ...fold, segments: [edited, second], task: {
    status: 'succeeded', segments: [original], force: false, progress: { phase: 'preparing', total: 1, completed: 1, failed: 0,
      completedSegmentUids: ['a'], failedSegmentUids: [], activeSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: [] }
  } }} />);
  fireEvent.click(view.getByRole('button', { name: '开始生成（2）' }));
  expect(start).toHaveBeenLastCalledWith([edited, second], false);
});

it('pauses, resumes and stops the existing queue independently of the current row selection', () => {
  const segments = [paragraph('a'), paragraph('b')], pause = vi.fn(), resume = vi.fn(), cancel = vi.fn(), start = vi.fn();
  const fold = { segments, pause, resume, cancel, start, task: { status: 'running', segments: [segments[0]], force: false,
    progress: { phase: 'generating', total: 1, completed: 0, failed: 0, activeSegmentUids: ['a'],
      completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: [] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  fireEvent.click(view.getByRole('button', { name: '暂停生成' }));
  expect(pause).toHaveBeenCalledOnce();
  view.rerender(<FoldTaskDialog open onOpenChange={vi.fn()} fold={{ ...fold, task: { ...fold.task!, status: 'pausing' } }} />);
  expect(view.getByRole('button', { name: '正在暂停…' })).toHaveProperty('disabled', true);
  view.rerender(<FoldTaskDialog open onOpenChange={vi.fn()} fold={{ ...fold, task: { ...fold.task!, status: 'paused', progress: { ...fold.task!.progress, activeSegmentUids: [] } } }} />);
  fireEvent.click(view.getByRole('checkbox', { name: '选择第 1 页第 2 段' }));
  expect(view.getByRole('button', { name: '取消所选（0）' })).toHaveProperty('disabled', true);
  fireEvent.click(view.getByRole('button', { name: '继续生成' }));
  expect(resume).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '停止全部' }));
  expect(cancel).toHaveBeenCalledOnce();
});

it('distinguishes loading, empty, failed reading and unavailable workspace without starting', () => {
  const start = vi.fn(), reload = vi.fn();
  const fold = { segments: [], start, reload, ready: false, loadState: 'loading' } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  expect(view.getByText('正在读取段落列表…')).toBeTruthy();
  view.rerender(<FoldTaskDialog open onOpenChange={vi.fn()} fold={{ ...fold, ready: true, loadState: 'ready' }} />);
  expect(view.getByText(/没有符合条件的正文段落/)).toBeTruthy();
  view.rerender(<FoldTaskDialog open onOpenChange={vi.fn()} fold={{ ...fold, segments: [paragraph('a')], ready: true, loadState: 'error' }} />);
  fireEvent.click(view.getByRole('button', { name: '重试读取' }));
  expect(reload).toHaveBeenCalledOnce();
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  expect(view.getByRole('button', { name: '开始生成（1）' })).toHaveProperty('disabled', true);
  view.rerender(<FoldTaskDialog open onOpenChange={vi.fn()} fold={{ ...fold, root: null, segments: [paragraph('a')], ready: true, loadState: 'ready' }} />);
  expect(view.getByRole('button', { name: '选择未生成' })).toHaveProperty('disabled', true);
  expect(start).not.toHaveBeenCalled();
});

it('shows actual batch progress and retries only unfinished paragraphs', () => {
  const segments = ['a', 'b', 'c', 'd'].map(paragraph);
  const start = vi.fn();
  const fold = { start, cancel: vi.fn(), task: { status: 'failed', segments, force: true,
    error: '模型请求超时，请检查模型服务或网络后重试；已有结果保留。',
    progress: { phase: 'preparing', total: 3, completed: 1, failed: 1, activeSegmentUids: [],
      completedSegmentUids: ['a'], failedSegmentUids: ['b'], cachedSegmentUids: ['d'], segmentErrors: { b: '该段输出达到长度上限' } } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  expect(view.getByRole('alert').textContent).toContain('模型请求超时');
  expect(view.getByRole('cell', { name: '失败：该段输出达到长度上限' }).getAttribute('title')).toBe('该段输出达到长度上限');
  expect(view.getByText(/已处理 2\/3 段/)).toBeTruthy();
  expect(view.getByText('67%')).toBeTruthy();
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('67');
  for (const label of ['已完成', '失败', '未完成', '已缓存']) expect(view.getByText(label)).toBeTruthy();
  fireEvent.click(view.getByRole('checkbox', { name: '选择第 1 页第 2 段' }));
  fireEvent.click(view.getByRole('checkbox', { name: '选择第 1 页第 3 段' }));
  fireEvent.click(view.getByRole('button', { name: '开始生成（2）' }));
  expect(start).toHaveBeenCalledWith([segments[1], segments[2]], false);
});

it('confirms before replacing an existing result and supports selecting all rows', () => {
  const segments = [paragraph('a'), paragraph('b')];
  const start = vi.fn();
  const fold = { start, task: { status: 'succeeded', segments, force: false,
    progress: { phase: 'preparing', total: 1, completed: 1, failed: 0, activeSegmentUids: [],
      completedSegmentUids: ['a'], failedSegmentUids: [], cachedSegmentUids: ['b'], canceledSegmentUids: [] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  expect(view.getByRole('button', { name: '开始生成（0）' })).toHaveProperty('disabled', true);
  fireEvent.click(view.getByRole('button', { name: '重新生成所选（2）' }));
  expect(start).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '确认重新生成' }));
  expect(start).toHaveBeenCalledWith(segments, true);
});

it('cancels selected active and waiting rows without allowing a saved row to be canceled', () => {
  const segments = [paragraph('a'), paragraph('b'), paragraph('c')];
  const cancelSegments = vi.fn();
  const fold = { cancel: vi.fn(), cancelSegments, task: { status: 'running', segments, force: false,
    progress: { phase: 'generating', total: 3, completed: 1, failed: 0, activeSegmentUids: ['b'],
      completedSegmentUids: ['a'], failedSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: [] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '取消所选（2）' }));
  expect(cancelSegments).toHaveBeenCalledWith(['b', 'c']);
});

it('distinguishes saving and generating rows when several paragraphs are active', () => {
  const segments = [paragraph('a'), paragraph('b')];
  const cancelSegments = vi.fn();
  const fold = { cancel: vi.fn(), cancelSegments, task: { status: 'running', segments, force: false,
    progress: { phase: 'generating', total: 2, completed: 0, failed: 0, activeSegmentUids: ['a', 'b'], savingSegmentUids: ['b'],
      completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: [] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  expect(view.getByText('生成中')).toBeTruthy();
  expect(view.getByText('保存中')).toBeTruthy();
  fireEvent.click(view.getByRole('checkbox', { name: '全选当前列表' }));
  fireEvent.click(view.getByRole('button', { name: '取消所选（1）' }));
  expect(cancelSegments).toHaveBeenCalledWith(['a']);
});

it('shows stopping feedback while waiting for cancellation', () => {
  const fold = { cancel: vi.fn(), task: { status: 'stopping', segments: [paragraph('a')], force: false,
    progress: { phase: 'generating', total: 1, completed: 0, failed: 0, activeSegmentUids: ['a'],
      completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: [] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  expect(view.getByText(/正在停止生成/)).toBeTruthy();
  expect(view.getByRole('button', { name: '正在停止…' })).toHaveProperty('disabled', true);
});

it('clearly reports when every selected paragraph was already cached', () => {
  const fold = { task: { status: 'succeeded', segments: [paragraph('a')], force: false,
    progress: { phase: 'preparing', total: 0, completed: 0, failed: 0, activeSegmentUids: [],
      completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: ['a'] } } } as unknown as FoldReader;
  const view = render(<FoldTaskDialog open onOpenChange={vi.fn()} fold={fold} />);
  expect(view.getByText('已有结果，无需生成')).toBeTruthy();
  expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
});
