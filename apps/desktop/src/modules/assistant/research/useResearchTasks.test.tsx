// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useResearchTasks } from './useResearchTasks';
const ipc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/shared/ipc/deepResearchApi', () => ({ deepResearchCommand: ipc.call }));
afterEach(cleanup);
it('mount and reopen only read persisted tasks; never silently resubmit research', async () => {
  const actions: string[] = [];
  ipc.call.mockImplementation(async (_root, action) => { actions.push(action.kind); if (action.kind === 'status') return { ready:true, active:null }; if (action.kind === 'list') return [{id:'saved',query:'Question',status:'completed'}]; return {id:'saved',report:'Original report',status:'completed'}; });
  const first = renderHook(() => useResearchTasks('root'));
  await waitFor(() => expect(first.result.current.tasks).toHaveLength(1));
  act(() => first.result.current.select('saved')); await waitFor(() => expect(first.result.current.task?.report).toBe('Original report'));
  first.unmount(); const second = renderHook(() => useResearchTasks('root')); await waitFor(() => expect(second.result.current.tasks).toHaveLength(1));
  expect(actions).not.toContain('start');
});
it('ignores a late task result after changing selection', async () => {
  let resolveOld!: (value: unknown) => void;
  ipc.call.mockImplementation(async (_root, action) => {
    if (action.kind === 'status') return { ready:true,active:null };
    if (action.kind === 'list') return [];
    if (action.id === 'old') return new Promise(resolve => { resolveOld = resolve; });
    return { id:'new',report:'New report' };
  });
  const ui = renderHook(() => useResearchTasks('root'));
  await waitFor(() => expect(ui.result.current.loading).toBe(false)); act(() => ui.result.current.select('old'));
  await waitFor(() => expect(resolveOld).toBeDefined()); act(() => ui.result.current.select('new'));
  await waitFor(() => expect(ui.result.current.task?.id).toBe('new'));
  await act(async () => { resolveOld({id:'old',report:'Stale'}); }); expect(ui.result.current.task?.id).toBe('new');
});
