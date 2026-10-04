// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Job } from '@/shared/ipc/workspaceApi';
import { JobStatusDock, type AssistantDockTask } from './JobStatusDock';
import { setAssistantDebug } from '@/shared/lib/assistantDebug';

afterEach(() => { cleanup(); setAssistantDebug(false); window.localStorage.clear(); vi.restoreAllMocks(); });
it('shows paper imports with honest counts and safe failure text beside translation tasks', () => {
  const common = { scope: null, created_at: '', updated_at: '', error: null, message: null };
  const failed: Job = { ...common, id: 'research-import:batch', kind: 'pdf_import', status: 'failed',
    progress: { current: 2, total: 6, percent: 100 / 3 },
    error: '论文下载超时 · 已处理 2/6 篇 · 已入库 2 · 当前论文：很长的论文标题。请核对资料库后重试。' };
  const translation: Job = { ...common, id: 'translation', kind: 'translation', status: 'processing',
    progress: { current: 0, total: 12, percent: 0 }, message: '已接收 200 字' };
  const view = render(<JobStatusDock activeCount={1} jobs={[translation, failed]} />);
  fireEvent.click(view.getByRole('button', { name: '实时任务：1 个未完成任务' }));
  expect(view.queryByRole('group', { name: '论文下载与添加' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '最近已结束 · 1' }));
  const downloads = within(view.getByRole('group', { name: '论文下载与添加' }));
  expect(downloads.getByText('失败 · 已处理 2/6 篇')).toBeTruthy();
  expect(downloads.queryByText(failed.error!)).toBeNull();
  expect(downloads.getByText('论文添加未完成，请先核对条目库。').className).not.toContain('truncate');
  expect(downloads.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(String(100 / 3));
  expect(within(view.getByRole('group', { name: '全文翻译' })).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  expect(view.getAllByText('正在翻译 · 已接收 200 字').length).toBeGreaterThan(0);
});

it('shows no task control for an empty list', () => {
  const view = render(<JobStatusDock activeCount={0} jobs={[]} />);
  expect(view.queryByRole('button')).toBeNull();
});
it('protects both the summary and a historical failed download when debug is explicitly enabled', () => {
  const raw = 'Timeout HTTP 503 Authorization: Bearer sk-secret C:\\Users\\Alice\\private.pdf REMOTE_BODY';
  const failed: Job = { id: 'research-import:old', kind: 'pdf_import', status: 'failed', scope: null,
    created_at: '', updated_at: '', error: raw, message: raw, progress: { current: 1, total: 3, percent: 100 / 3 } };
  const ui = render(<JobStatusDock activeCount={0} jobs={[failed]} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：最近任务有失败' }));
  fireEvent.click(ui.getByRole('button', { name: '最近已结束 · 1' }));
  expect(ui.queryByText(raw)).toBeNull();
  act(() => setAssistantDebug(true));
  expect(ui.getAllByText(/调试：请求超时 · HTTP 503/)).toHaveLength(2);
  expect(ui.baseElement.innerHTML).not.toContain('sk-secret');
  expect(ui.baseElement.innerHTML).not.toContain('REMOTE_BODY');
  expect(ui.getByText('失败 · 已处理 1/3 篇')).toBeTruthy();
});
it.each(['paused', 'canceled'] as const)('distinguishes %s without showing running animation', status => {
  const job: Job = { id: 'j', kind: 'translation', status, scope: null, created_at: '', updated_at: '', error: null, message: null,
    progress: { current: 1, total: 2, percent: 50 } };
  const view = render(<JobStatusDock activeCount={0} jobs={[job]} />);
  expect(view.getByRole('button', { name: status === 'paused' ? '实时任务：1 个未完成任务' : '实时任务：最近任务' })).toBeTruthy();
  expect(view.container.querySelector('.animate-spin')).toBeNull();
});

const baseJob: Job = { id: 'job', kind: 'parser', status: 'processing', scope: null, created_at: '', updated_at: '',
  error: null, message: null, progress: { current: 0, total: 0, percent: 0 } };
const baseAssistant: AssistantDockTask = { id: 'assistant', title: '整理阅读笔记', question: '比较这两篇论文',
  status: 'running', canOpen: true, canStop: true };

it('derives unfinished count from jobs and conversations, retaining paused and waiting tasks ahead of history', () => {
  const jobs: Job[] = [
    { ...baseJob, id: 'done', status: 'succeeded' },
    { ...baseJob, id: 'queued', status: 'queued' },
    { ...baseJob, id: 'paused', kind: 'translation', status: 'paused' },
  ];
  const tasks: AssistantDockTask[] = [baseAssistant, { ...baseAssistant, id: 'waiting', title: '等待下载确认',
    status: 'waiting', detail: '等待操作确认', queuedCount: 3 }];
  const ui = render(<JobStatusDock activeCount={99} jobs={jobs} assistantTasks={tasks} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：4 个未完成任务' }));
  const pending = within(ui.getByRole('region', { name: '未完成任务' }));
  expect(pending.getAllByRole('group')).toHaveLength(4);
  expect(pending.getByText('3 条消息待发送')).toBeTruthy();
  expect(pending.getByText('等待操作确认')).toBeTruthy();
  expect(ui.getByText('1 进行中 · 1 排队 · 1 暂停 · 1 等待你处理')).toBeTruthy();
  expect(ui.queryByRole('region', { name: '最近已结束任务' })).toBeNull();
  expect(ui.queryAllByRole('progressbar')).toHaveLength(0);
});

it.each(['waiting', 'queued', 'paused', 'stopping'] as const)('does not animate or invent percentages for an assistant in %s state', status => {
  const ui = render(<JobStatusDock jobs={[]} assistantTasks={[{ ...baseAssistant, status }]} onStopAssistantTask={vi.fn()} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：1 个未完成任务' }));
  expect(ui.baseElement.querySelector('.animate-spin')).toBeNull();
  expect(ui.queryByRole('progressbar')).toBeNull();
  if (status === 'stopping') expect(ui.getByRole('button', { name: '停止对话：整理阅读笔记' }).hasAttribute('disabled')).toBe(true);
  if (status === 'paused' || status === 'queued') expect(ui.queryByRole('button', { name: '停止对话：整理阅读笔记' })).toBeNull();
});

it('opens and stops only the selected conversation and does not stop when dismissing the dock', async () => {
  const open = vi.fn();
  const stop = vi.fn();
  const ui = render(<JobStatusDock jobs={[]} assistantTasks={[baseAssistant, { ...baseAssistant, id: 'other', title: '另一对话' }]}
    onOpenAssistantTask={open} onStopAssistantTask={stop} />);
  const trigger = ui.getByRole('button', { name: '实时任务：2 个未完成任务' });
  fireEvent.click(trigger);
  fireEvent.click(ui.getByRole('button', { name: '停止对话：另一对话' }));
  expect(stop).toHaveBeenCalledExactlyOnceWith('other');
  expect(ui.getByRole('dialog', { name: '实时任务' })).toBeTruthy();
  fireEvent.click(ui.getByRole('button', { name: '返回对话：整理阅读笔记' }));
  expect(open).toHaveBeenCalledExactlyOnceWith('assistant');
  await waitFor(() => expect(ui.queryByRole('dialog', { name: '实时任务' })).toBeNull());
  fireEvent.click(trigger);
  fireEvent.keyDown(ui.getByRole('dialog', { name: '实时任务' }), { key: 'Escape' });
  await waitFor(() => expect(ui.queryByRole('dialog', { name: '实时任务' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(stop).toHaveBeenCalledTimes(1);
});

it('returns entry-scoped jobs to their owning page without providing a false destination for workspace tasks', () => {
  const open = vi.fn();
  const entryJob: Job = { ...baseJob, scope: { kind: 'entry', root: 'test', entry_id: 'paper' } };
  const ui = render(<JobStatusDock jobs={[entryJob, { ...baseJob, id: 'index', kind: 'index_build', scope: { kind: 'workspace', root: 'test' } }]}
    onOpenJob={open} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：2 个未完成任务' }));
  expect(ui.queryByRole('button', { name: '查看任务：索引构建' })).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '查看任务：PDF 解析' }));
  expect(open).toHaveBeenCalledExactlyOnceWith(entryJob);
});

it('preserves parser queue position and configuration guidance and distinguishes selection and segment translation', () => {
  const ui = render(<JobStatusDock jobs={[
    { ...baseJob, id: 'parse-queue:paper', status: 'queued', message: '演示论文 · 等待配置解析服务，可在条目库调整队列' },
    { ...baseJob, id: 'selection-translation:one', kind: 'paragraph_translation' },
    { ...baseJob, id: 'single-segment-translation:two', kind: 'paragraph_translation' },
  ]} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：3 个未完成任务' }));
  expect(ui.getByText('演示论文 · 等待配置解析服务，可在条目库调整队列')).toBeTruthy();
  expect(ui.getByRole('group', { name: '选区翻译' })).toBeTruthy();
  expect(ui.getByRole('group', { name: '片段翻译' })).toBeTruthy();
});

it('identifies each entry task by its actual paper title without exposing internal IDs when a title is unavailable', () => {
  const title = 'Attention Is All You Need（中文阅读笔记演示论文）';
  const jobs: Job[] = ['paper-one', 'paper-missing'].map(id => ({ ...baseJob, id, scope: { kind: 'entry', root: 'test', entry_id: id } }));
  const ui = render(<JobStatusDock jobs={jobs} entryTitles={{ 'paper-one': title }} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：2 个未完成任务' }));
  expect(ui.getByText(title).getAttribute('title')).toBe(title);
  expect(ui.getByText(title).className).toContain('truncate');
  expect(ui.baseElement.textContent).not.toContain('paper-missing');
  expect(ui.baseElement.textContent).not.toContain('paper-one');
});

it('orders running, waiting and queued work across task sources before paused work without duplicating rows', () => {
  const assistants: AssistantDockTask[] = [
    { ...baseAssistant, id: 'paused-assistant', title: '暂停对话', status: 'paused' },
    { ...baseAssistant, id: 'waiting-assistant', title: '等待对话', status: 'waiting' },
    { ...baseAssistant, id: 'running-assistant', title: '运行对话' },
  ];
  const jobs: Job[] = [
    { ...baseJob, id: 'paused-job', kind: 'translation', status: 'paused' },
    { ...baseJob, id: 'queued-job', kind: 'parser', status: 'queued' },
    { ...baseJob, id: 'running-job', kind: 'pdf_import', status: 'processing' },
  ];
  const ui = render(<JobStatusDock jobs={jobs} assistantTasks={assistants} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：6 个未完成任务' }));
  const rows = within(ui.getByRole('region', { name: '未完成任务' })).getAllByRole('group');
  expect(rows.map(row => row.getAttribute('aria-label'))).toEqual([
    '助手对话：运行对话', 'PDF 导入', '助手对话：等待对话', 'PDF 解析', '助手对话：暂停对话', '全文翻译',
  ]);
  expect(assistants[0].id).toBe('paused-assistant');
  expect(jobs[0].id).toBe('paused-job');
});

it('keeps every unfinished row in one bounded scroll area without exposing disabled actions', () => {
  const tasks = Array.from({ length: 60 }, (_, index) => ({ ...baseAssistant, id: `task-${index}`, title: `任务 ${index}`, canOpen: false, canStop: false }));
  const open = vi.fn();
  const stop = vi.fn();
  const ui = render(<JobStatusDock jobs={[]} assistantTasks={tasks} onOpenAssistantTask={open} onStopAssistantTask={stop} />);
  fireEvent.click(ui.getByRole('button', { name: '实时任务：60 个未完成任务' }));
  expect(ui.getAllByRole('group')).toHaveLength(60);
  const scrollArea = ui.getByRole('region', { name: '未完成任务' }).parentElement!;
  expect(scrollArea.className).toContain('overflow-y-auto');
  expect(scrollArea.className).toContain('min-h-0');
  expect(scrollArea.querySelectorAll('.overflow-y-auto')).toHaveLength(0);
  fireEvent.click(ui.getByRole('button', { name: '返回对话：任务 59' }));
  fireEvent.click(ui.getByRole('button', { name: '停止对话：任务 59' }));
  expect(open).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

it('marks only its floating panel for native clipping and closes after Escape without changing tasks', async () => {
  const stop = vi.fn();
  const ui = render(<JobStatusDock jobs={[]} assistantTasks={[baseAssistant]} onStopAssistantTask={stop} />);
  expect(document.querySelector('[data-native-browser-overlay]')).toBeNull();
  const trigger = ui.getByRole('button', { name: '实时任务：1 个未完成任务' });
  fireEvent.click(trigger);
  const panel = ui.getByRole('dialog', { name: '实时任务' });
  expect(within(panel).getByRole('group', { name: '助手对话：整理阅读笔记' })).toBeTruthy();
  expect(panel.dataset.nativeBrowserOverlay).toBe('task-dock');
  expect(document.querySelectorAll('[data-native-browser-overlay]')).toHaveLength(1);
  // A fixed clipping rectangle must not be sampled halfway through Radix's scale/slide animation.
  expect(panel.className).toContain('data-open:animate-none');
  expect(panel.className).toContain('data-closed:animate-none');
  fireEvent.keyDown(panel, { key: 'Escape' });
  await waitFor(() => expect(ui.queryByRole('dialog', { name: '实时任务' })).toBeNull());
  expect(document.querySelector('[data-native-browser-overlay]')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(stop).not.toHaveBeenCalled();
});
