// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DailyProvider, useDaily, type DailyModel } from './DailyContext';
import { TodoWidget } from './TodoWidget';
import { saveSegmentEditorsBeforeClose, hasAnyUnsavedSegmentEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import type { DailyState } from '@/shared/types/daily';
import { DailyTodos } from './DailyTodos';
import { newWidget } from './dailyWidgets';
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: ipc.invoke }));
let saved: DailyState, revision: number, fail: boolean, model: DailyModel;
const widget = { ...newWidget('todos'), id: 'todo-widget' };
function Probe() { model = useDaily()!; return <><span>{model.error}</span><span>{model.date}</span><TodoWidget widget={model.state?.widgets[0] ?? widget} /><button onClick={model.retry}>retry</button></>; }
beforeEach(() => {
  revision = 0; fail = false;
  saved = { version: 1, widgets: [widget], lists: [{ id: 'inbox', title: 'Inbox' }], todos: [], recommendation_preferences: { interests: [], exclusions: [], enabled: false } };
  ipc.invoke.mockReset().mockImplementation(async (command, { request }) => {
    if (command === 'daily_recommendations') return { version: 1, batches: [], feedback: [], last_attempt_at: null, last_error: null };
    if (request.action.kind === 'save') { if (fail) throw new Error('disk unavailable'); saved = structuredClone(request.action.state); revision++; }
    return { revision: String(revision), state: structuredClone(saved) };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const setup = () => render(<DailyProvider root="test-library" openNote={vi.fn()}><Probe /></DailyProvider>);
const sidebar = () => render(<DailyProvider root="test-library" openNote={vi.fn()}><DailyTodos /></DailyProvider>);

it('always shows todos without component controls and preserves legacy notes and layout', async () => {
  saved.widgets = [{ ...newWidget('note'), id: 'saved-note', note: { owner: { kind: 'daily', date: '2026-10-23' }, note_id: 'journal' } }, { ...widget, collapsed: true, selected_date_only: true }];
  const original = structuredClone(saved.widgets);
  saved.todos = Array.from({ length: 7 }, (_, i) => ({ id: 'old-' + i, list_id: 'inbox', text: 'Task ' + i, date: '2020-01-01', completed: false, deleted: false }));
  const ui = sidebar(); await waitFor(() => expect(ui.getByLabelText('新待办')).toBeTruthy());
  expect(ui.container.querySelectorAll('[data-widget-id]')).toHaveLength(1);
  expect(ui.getByText('Task 6')).toBeTruthy();
  expect(ui.queryByRole('button', { name: '切换看板组件' })).toBeNull();
  expect(ui.queryByRole('button', { name: '组件设置' })).toBeNull();
  expect(saved.widgets).toEqual(original);
  expect(ipc.invoke.mock.calls.filter(([, args]) => args.request.action.kind === 'save')).toHaveLength(0);
});

it('allows adding todos even when a legacy layout contains no todo widget', async () => {
  saved.widgets = [{ ...newWidget('note'), id: 'saved-note' }];
  const ui = sidebar(); await waitFor(() => expect(ui.getByLabelText('新待办')).toBeTruthy());
  fireEvent.change(ui.getByLabelText('新待办'), { target: { value: 'Keep this task' } });
  fireEvent.submit(ui.getByLabelText('新待办').closest('form')!);
  await waitFor(() => expect(saved.todos).toHaveLength(1));
  expect(saved.todos[0]).toMatchObject({ text: 'Keep this task', list_id: 'inbox' });
  expect(saved.widgets.map(item => item.id)).toEqual(['saved-note']);
});

it('shows existing todos across lists and lets users reveal and undo completed items', async () => {
  saved.lists.push({ id: 'research', title: 'Research' });
  saved.todos = [
    { id: 'one', list_id: 'inbox', text: 'Pending', date: null, completed: false, deleted: false },
    { id: 'two', list_id: 'research', text: 'Finished', date: null, completed: true, deleted: false },
  ];
  const ui = sidebar(); await waitFor(() => expect(ui.getByText('Pending')).toBeTruthy());
  expect(ui.queryByText('Finished')).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '显示已完成' }));
  fireEvent.click(ui.getByRole('checkbox', { name: 'Finished' }));
  await waitFor(() => expect(saved.todos[1].completed).toBe(false));
  expect(saved.todos[1].list_id).toBe('research');
});

it('retains a todo draft and reports failed saves in the fixed sidebar', async () => {
  const ui = sidebar(); await waitFor(() => expect(ui.getByLabelText('新待办')).toBeTruthy()); fail = true;
  fireEvent.change(ui.getByLabelText('新待办'), { target: { value: 'Unsaved task' } });
  fireEvent.click(ui.getByRole('button', { name: '添加待办' }));
  await waitFor(() => expect(ui.getByRole('alert').textContent).toContain('disk unavailable'));
  expect((ui.getByLabelText('新待办') as HTMLInputElement).value).toBe('Unsaved task');
  fail = false; fireEvent.click(ui.getByRole('button', { name: '重试保存或读取' }));
  await waitFor(() => expect(saved.todos).toHaveLength(1));
});

it('saves pending todo drafts before widget removal and keeps cross-day items', async () => {
  const ui = setup(); await waitFor(() => expect(model.loading).toBe(false));
  fireEvent.change(ui.getByLabelText('新待办'), { target: { value: 'Read diffusion paper' } });
  expect(hasAnyUnsavedSegmentEditors()).toBe(true);
  let safe = false;
  await act(async () => { safe = await saveSegmentEditorsBeforeClose('daily-widgets'); });
  expect(safe).toBe(true); expect(saved.todos[0].text).toBe('Read diffusion paper');
  expect(hasAnyUnsavedSegmentEditors()).toBe(false);
  await act(async () => { model.selectDate('2026-01-01'); });
  expect(ui.getByText('Read diffusion paper')).toBeTruthy();
  await act(async () => { await model.mutate(s => ({ ...s, widgets: [] })); });
  expect(saved.todos).toHaveLength(1); expect(saved.widgets).toHaveLength(0);
});
it('failed writes retain the draft, block closing and retry without duplicate todos', async () => {
  const ui = setup(); await waitFor(() => expect(model.loading).toBe(false)); fail = true;
  fireEvent.change(ui.getByLabelText('新待办'), { target: { value: 'Keep draft' } });
  let safe = true; await act(async () => { safe = await saveSegmentEditorsBeforeClose('daily-widgets'); });
  expect(safe).toBe(false); expect(saved.todos).toHaveLength(0); expect(ui.getByText(/disk unavailable/)).toBeTruthy();
  fail = false; fireEvent.click(ui.getByText('retry')); await waitFor(() => expect(model.busy).toBe(false));
  await act(async () => { safe = await saveSegmentEditorsBeforeClose('daily-widgets'); });
  expect(safe).toBe(true); expect(saved.todos).toHaveLength(1);
});
it('soft deletes and restores the original todo rather than copying it', async () => {
  saved.todos = [{ id: 'one', list_id: 'inbox', text: 'Existing', date: null, completed: false, deleted: false }];
  const ui = setup(); await waitFor(() => expect(ui.getByText('Existing')).toBeTruthy());
  fireEvent.keyDown(ui.getByRole('button', { name: '待办操作：Existing' }), { key: 'Enter' });
  fireEvent.click(ui.getByText('删除')); await waitFor(() => expect(saved.todos[0].deleted).toBe(true));
  fireEvent.click(ui.getByText('恢复')); await waitFor(() => expect(saved.todos[0].deleted).toBe(false));
  expect(saved.todos).toHaveLength(1);
});
it('shows the optional date only while composing and saves it with the new todo', async () => {
  const ui = setup(); await waitFor(() => expect(model.loading).toBe(false));
  expect(ui.queryByLabelText('待办计划日期（可选）')).toBeNull();
  fireEvent.change(ui.getByLabelText('新待办'), { target: { value: 'Read next paper' } });
  fireEvent.change(ui.getByLabelText('待办计划日期（可选）'), { target: { value: '2026-10-24' } });
  fireEvent.click(ui.getByRole('button', { name: '添加待办' }));
  await waitFor(() => expect(saved.todos).toHaveLength(1));
  expect(saved.todos[0]).toMatchObject({ text: 'Read next paper', date: '2026-10-24' });
  await waitFor(() => expect(ui.queryByLabelText('待办计划日期（可选）')).toBeNull());
});
it('compact todo lists retain all records and expand without losing the draft', async () => {
  saved.todos = Array.from({ length: 7 }, (_, i) => ({ id: `todo-${i}`, list_id: 'inbox', text: `Task ${i}`, date: null, completed: false, deleted: false }));
  const ui = setup(); await waitFor(() => expect(ui.getByText('Task 4')).toBeTruthy());
  expect(ui.queryByText('Task 6')).toBeNull();
  fireEvent.change(ui.getByLabelText('新待办'), { target: { value: 'Unsubmitted draft' } });
  fireEvent.click(ui.getByText('显示全部 7 项'));
  await waitFor(() => expect(ui.getByText('Task 6')).toBeTruthy());
  expect((ui.getByLabelText('新待办') as HTMLInputElement).value).toBe('Unsubmitted draft');
  expect(saved.todos).toHaveLength(7);
});
it('reads a newly selected recommendation date after an earlier request finishes', async () => {
  let release!: (value: unknown) => void;
  const original = ipc.invoke.getMockImplementation()!;
  let first = true;
  ipc.invoke.mockImplementation((command, args) => {
    if (command === 'daily_recommendations' && first) { first = false; return new Promise(resolve => { release = resolve; }); }
    return original(command, args);
  });
  setup(); await waitFor(() => expect(model.loading).toBe(false));
  await act(async () => { model.selectDate('2026-01-01'); });
  await act(async () => { release({ version: 1, batches: [], feedback: [], last_attempt_at: null, last_error: null }); });
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith('daily_recommendations', { request: { root: 'test-library', action: { kind: 'read', date: '2026-01-01' } } }));
});
