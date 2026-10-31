// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { IdeationState } from '@/shared/ipc/ideationApi';
import { useIdeationBackground } from './useIdeationBackground';

const mocks = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), generate: vi.fn(), settings: vi.fn() }));
vi.mock('@/shared/ipc/ideationApi', () => ({ listIdeationDrafts: mocks.list, saveIdeationDraft: mocks.save }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: mocks.settings, subscribeLlmSettings: () => () => {} }));
vi.mock('./generateCards', async importOriginal => ({ ...(await importOriginal<typeof import('./generateCards')>()), generatePaperCards: mocks.generate }));
const entries = [
  { id: 'a', title: '论文 A', status: 'Parsed' }, { id: 'b', title: '论文 B', status: 'Parsed' },
  { id: 'c', title: '未解析', status: 'Not started' }
] as LibraryEntry[];
const initial: IdeationState = { version: 1, cards: [], placements: [] };
function Fixture({ state = initial }: { state?: IdeationState }) {
  const job = useIdeationBackground('root', entries, state, true);
  return <><span data-testid="active">{job.activeId ?? ''}</span><span data-testid="done">{job.summaries?.map(s => `${s.entry_id}:${s.status}`).join(',')}</span>
    <button onClick={() => job.setEnabled(false)}>暂停</button><button onClick={() => job.setEnabled(true)}>继续</button></>;
}
beforeEach(() => {
  localStorage.clear(); mocks.list.mockResolvedValue([]); mocks.settings.mockResolvedValue({ assistant_profile: { id: 'model' } });
  mocks.save.mockImplementation(async (_root, _expected, draft) => ({ revision: `r-${draft.entry_id}`, draft }));
});
it('still generates a separate draft for a paper with an existing user card', async () => {
  mocks.list.mockResolvedValue([{ entry_id: 'b', status: 'failed', cards: [], error_code: 'model' }]);
  mocks.generate.mockResolvedValue({ entryId: 'a', model: 'model', partial: false, cards: [{ id: 'generated', kind: 'method', title: '方法', body: '内容', sources: [] }] });
  const state = { version: 1 as const, cards: [{ id: 'existing', entry_id: 'a', kind: 'method' as const, title: '我的卡片', body: '我的内容' }], placements: [] };
  render(<Fixture state={state} />);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('root', 'missing', expect.objectContaining({ entry_id: 'a', cards: [expect.objectContaining({ id: 'generated' })] })));
  expect(state.cards[0].body).toBe('我的内容');
});
it('retries an old failure once and stores a safe reason if it fails again', async () => {
  mocks.list.mockResolvedValue([{ entry_id: 'a', status: 'failed', revision: 'old', cards: [] }, { entry_id: 'b', status: 'failed', revision: 'b', cards: [], error_code: 'model' }]);
  mocks.generate.mockRejectedValue(new Error('provider error containing private details'));
  render(<Fixture />);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('root', 'old', expect.objectContaining({ entry_id: 'a', status: 'failed', error_code: 'model' })));
  await waitFor(() => expect(screen.getByTestId('done').textContent).toContain('a:failed'));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('processes parsed papers sequentially, persists reviewable drafts and records failures', async () => {
  mocks.generate.mockImplementation(async (_root, id) => {
    if (id === 'b') throw new Error('provider error containing private details');
    return { entryId: id, model: 'model', partial: true, cards: [{ id: 'card-a', kind: 'method', title: '方法', body: '内容', sources: [] }] };
  });
  render(<Fixture />);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.generate.mock.calls.map(call => call[1])).toEqual(['a', 'b']);
  expect(mocks.save.mock.calls[0][2]).toMatchObject({ entry_id: 'a', status: 'ready', cards: [{ id: 'card-a', entry_id: 'a' }] });
  expect(JSON.stringify(mocks.save.mock.calls[1][2])).not.toContain('private details');
  await waitFor(() => expect(screen.getByTestId('done').textContent).toContain('b:failed'));
});
it('pauses an in-flight generation without saving its late result', async () => {
  let resolve!: (value: unknown) => void;
  mocks.generate.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<Fixture />);
  await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('a'));
  const signal = mocks.generate.mock.calls[0][2] as AbortSignal;
  fireEvent.click(screen.getByText('暂停'));
  expect(signal.aborted).toBe(true);
  resolve({ entryId: 'a', model: 'model', partial: false, cards: [{ id: 'c', kind: 'method', title: '方法', body: '内容', sources: [] }] });
  await waitFor(() => expect(screen.getByTestId('active').textContent).toBe(''));
  expect(mocks.save).not.toHaveBeenCalled();
});
