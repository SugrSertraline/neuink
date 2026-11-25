// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useResearchChat } from './useResearchChat';
import { researchSelections } from './researchChat';
import type { ResearchModel } from './useResearchTasks';
afterEach(cleanup);
function model(ready = true) {
  return { status: { ready, active: null }, selected: 'previous', select: vi.fn(), command: vi.fn(async action => action.kind === 'preview_scope' ? { scope_hash: 'frozen' } : { id: 'next' }) } as unknown as ResearchModel;
}
it('sending uses the chat model, auto sources and server-owned depth; preserves follow-up identity', async () => {
  const state = model(); const ui = renderHook(() => useResearchChat('workspace', state));
  let sent = false; await act(async () => { sent = await ui.result.current.send('Question', 'chat-model', []); });
  expect(sent).toBe(true);
  expect(state.command).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'start', query: 'Question', profile_id: 'chat-model', parent_id: 'previous', scope_hash: 'frozen' }));
  const start = vi.mocked(state.command).mock.calls[1][0];
  expect(start).not.toHaveProperty('retriever'); expect(start).not.toHaveProperty('depth'); expect(start).not.toHaveProperty('timeout_seconds');
  expect(state.select).toHaveBeenCalledWith('next');
});
it('missing component keeps the question unsent; installing is a separate explicit action', async () => {
  const state = model(false); const ui = renderHook(() => useResearchChat('workspace', state));
  await act(async () => { expect(await ui.result.current.send('Question', 'model', [])).toBe(false); });
  expect(state.command).not.toHaveBeenCalled(); expect(ui.result.current.error).toContain('安装');
});
it('double Enter cannot submit twice while the scope is being frozen', async () => {
  const state = model(); let resolve!: (v: unknown) => void;
  vi.mocked(state.command).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const ui = renderHook(() => useResearchChat('workspace', state));
  let first!: Promise<boolean>;
  act(() => { first = ui.result.current.send('Question', 'model', []); });
  await act(async () => { expect(await ui.result.current.send('Question', 'model', [])).toBe(false); resolve({ scope_hash: 'frozen' }); await first; });
  expect(state.command).toHaveBeenCalledTimes(2);
});
it('switching libraries during preparation never sends the old scope', async () => {
  const state = model(); let resolve!: (v: unknown) => void;
  vi.mocked(state.command).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const ui = renderHook(({ root }) => useResearchChat(root, state), { initialProps: { root: 'old' } });
  let pending!: Promise<boolean>;
  act(() => { pending = ui.result.current.send('Question', 'model', []); });
  ui.rerender({ root: 'new' });
  await act(async () => { resolve({ scope_hash: 'old' }); expect(await pending).toBe(false); });
  expect(state.command).toHaveBeenCalledTimes(1); expect(state.select).not.toHaveBeenCalled(); expect(ui.result.current.sending).toBe(false);
});
it('research has no implicit library-wide selection and rejects over-broad explicit tags', () => {
  const entries = Array.from({ length: 11 }, (_, i) => ({ id: String(i), tagIds: ['topic'] })) as any;
  expect(researchSelections([], { mentions: [], text: 'question' }, entries)).toEqual([]);
  expect(() => researchSelections([], { mentions: [{kind:'tag',tagId:'topic'}] as any, text: '' }, entries)).toThrow('10');
});
