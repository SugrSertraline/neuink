// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RelationSuggestionsPanel } from './RelationSuggestionsPanel';
import { board, state } from './researchPlan.fixtures';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), update: vi.fn() }));
vi.mock('./IdeationContext', () => ({ useIdeationContext: () => ({ activeBoard: board, state, update: mocks.update }) }));
vi.mock('./relationSuggestions', async original => ({ ...await original<typeof import('./relationSuggestions')>(), generateRelationSuggestions: mocks.generate }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('previews suggestions without writing, then applies only on confirmation', async () => {
  const link = { id: 'suggestion-1', from: state.placements[0].id, to: state.placements[1].id, kind: 'input', reason: '表征可以作为输入', conditions: '尚需核对维度', origin: 'ai_inferred' };
  mocks.generate.mockResolvedValue([link]);
  const preview = vi.fn(), close = vi.fn();
  render(<RelationSuggestionsPanel onPreview={preview} onClose={close} onResearch={vi.fn()} />);

  await screen.findByRole('button', { name: '确认此项' });
  await waitFor(() => expect(preview).toHaveBeenCalledWith([expect.objectContaining({ id: link.id })]));
  expect(mocks.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认此项' }));
  expect(mocks.update).toHaveBeenCalledTimes(1);
});

it('ignores late suggestions after stopping and never writes on direct research', async () => {
  let finish!: (value: unknown) => void;
  mocks.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const research = vi.fn();
  render(<RelationSuggestionsPanel onPreview={vi.fn()} onClose={vi.fn()} onResearch={research} />);

  cleanup();
  await act(async () => finish([]));
  expect(screen.queryByText(/暂无合适的新关系/)).toBeNull();
  expect(mocks.update).not.toHaveBeenCalled();
});
