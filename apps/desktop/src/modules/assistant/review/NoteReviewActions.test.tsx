/** @vitest-environment jsdom */
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { NoteReviewProvider, useNoteReview } from './NoteReviewContext';
import { NoteReviewPage } from './NoteReviewPage';
import { useNoteReviewActions } from './useNoteReviewActions';
import { NoteDiffContext } from './NoteDiffLines';

afterEach(cleanup);
const proposal: AssistantNoteProposal = { id: 'p', entryId: 'e', entryTitle: 'Paper', noteId: 'n',
  title: 'Note', action: 'replace', beforeMarkdown: 'Old', markdown: 'New', sources: [], createdAt: '', status: 'pending' };
function Fixture({ apply, reject, conversationId = 'c', disabled = false, invalid = false }: {
  apply: (proposal: AssistantNoteProposal) => Promise<void>; reject: (proposal: AssistantNoteProposal) => Promise<void>;
  conversationId?: string; disabled?: boolean; invalid?: boolean;
}) {
  const review = useNoteReview()!;
  const [value, setValue] = useState({ ...proposal, beforeMarkdown: invalid ? null : proposal.beforeMarkdown });
  useEffect(() => review.publish([{ conversationId: 'c', messageId: 'm', proposal: value }]), [review.publish, value]);
  useNoteReviewActions({ conversationId, disabled,
    apply: async item => { await apply(item); setValue(current => ({ ...current, status: 'applied' })); },
    reject: async item => { await reject(item); setValue(current => ({ ...current, status: 'rejected' })); } });
  return <><NoteReviewPage proposalId="p" onOpenNote={() => {}} />
    <button onClick={() => { void review.decide('p', 'apply').catch(() => {}); }}>另一入口确认</button></>;
}
const wrap = (props: Parameters<typeof Fixture>[0]) => <NoteReviewProvider onOpen={() => {}} onShowAssistant={() => {}}><Fixture {...props} /></NoteReviewProvider>;

it('only confirms on click, locks both entry points, and reflects the authoritative result', async () => {
  let finish!: () => void;
  const apply = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(wrap({ apply, reject: vi.fn() }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
  fireEvent.click(screen.getByRole('button', { name: '另一入口确认' }));
  expect(apply).toHaveBeenCalledExactlyOnceWith(proposal);
  expect(screen.getByRole('button', { name: '确认应用' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '忽略修改' }).hasAttribute('disabled')).toBe(true);
  await act(async () => finish());
  expect(screen.getByText(/已应用 · 历史修改快照/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '确认应用' })).toBeNull();
});

it('rejects without applying', async () => {
  const apply = vi.fn(); const reject = vi.fn(async () => {});
  render(wrap({ apply, reject }));
  fireEvent.click(screen.getByRole('button', { name: '忽略修改' }));
  await waitFor(() => expect(screen.getByText(/已忽略 · 历史修改快照/)).toBeTruthy());
  expect(reject).toHaveBeenCalledExactlyOnceWith(proposal);
  expect(apply).not.toHaveBeenCalled();
});

it('shows failures, releases the decision lock and allows retry', async () => {
  const apply = vi.fn().mockRejectedValueOnce(new Error('请先保存草稿')).mockResolvedValueOnce(undefined);
  render(wrap({ apply, reject: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('请先保存草稿'));
  expect(screen.getByRole('button', { name: '确认应用' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
  await waitFor(() => expect(screen.getByText(/已应用 · 历史修改快照/)).toBeTruthy());
  expect(apply).toHaveBeenCalledTimes(2);
});

it('disables decisions for another or running conversation and invalid comparisons', () => {
  const apply = vi.fn(); const props = { apply, reject: vi.fn() };
  const ui = render(wrap({ ...props, conversationId: 'other' }));
  expect(screen.getByRole('button', { name: '确认应用' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '另一入口确认' }));
  expect(apply).not.toHaveBeenCalled();
  ui.rerender(wrap({ ...props, disabled: true }));
  expect(screen.getByRole('button', { name: '忽略修改' }).hasAttribute('disabled')).toBe(true);
  ui.unmount();
  render(wrap({ ...props, invalid: true }));
  expect(screen.getByRole('button', { name: '确认应用' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '忽略修改' }).hasAttribute('disabled')).toBe(false);
});

it('folds only unchanged context and can reveal every line', () => {
  const { container } = render(<NoteDiffContext text={Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')} />);
  expect(container.textContent).not.toContain('line 10');
  fireEvent.click(screen.getByRole('button', { name: '展开 14 行未修改内容' }));
  expect(container.textContent).toContain('line 10');
  fireEvent.click(screen.getByRole('button', { name: '收起未修改内容' }));
  expect(container.textContent).not.toContain('line 10');
});
