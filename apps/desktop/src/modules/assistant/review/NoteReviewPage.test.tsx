/** @vitest-environment jsdom */
import { useEffect } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { NoteReviewProvider, useNoteReview } from './NoteReviewContext';
import { NoteReviewBanner } from './NoteReviewBanner';
import { NoteReviewPage } from './NoteReviewPage';

const proposal: AssistantNoteProposal = {
  id: 'p', entryId: 'e', entryTitle: '论文', noteId: 'n', title: '研究笔记', action: 'replace',
  beforeMarkdown: '# 标题\n旧结论\n不变正文\n旧方法', markdown: '# 标题\n新结论\n不变正文\n新方法',
  createdAt: '', status: 'pending', sources: []
};
afterEach(cleanup);
function Publish({ value = proposal }: { value?: AssistantNoteProposal }) {
  const review = useNoteReview();
  useEffect(() => review?.publish([{ proposal: value, conversationId: 'conversation', messageId: 'message' }]), [review?.publish, value]);
  return <output>{review?.returnRequest?.conversationId ?? ''}</output>;
}
function Harness({ value = proposal, open = vi.fn(), back = vi.fn(), note = vi.fn() }: {
  value?: AssistantNoteProposal; open?: ReturnType<typeof vi.fn>; back?: ReturnType<typeof vi.fn>; note?: ReturnType<typeof vi.fn>;
}) {
  return <NoteReviewProvider onOpen={open} onShowAssistant={back}>
    <Publish value={value} /><NoteReviewBanner entryId="e" noteId="n" />
    <NoteReviewPage proposalId="p" onOpenNote={note} />
  </NoteReviewProvider>;
}
describe('note review navigation and read-only content', () => {
  it('links the note banner to review and review back to the exact conversation', () => {
    const open = vi.fn(); const back = vi.fn(); const note = vi.fn();
    render(<Harness open={open} back={back} note={note} />);
    fireEvent.click(screen.getByRole('button', { name: '查看修改' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation', proposal }));
    fireEvent.click(screen.getByRole('button', { name: '返回对话提案' }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe('conversation');
    fireEvent.click(screen.getByRole('button', { name: '打开当前笔记' }));
    expect(note).toHaveBeenCalledWith('e', 'n');
  });
  it('shows unified +/- changes by default, supports folding and never mounts an editor', () => {
    const { container } = render(<Harness />);
    expect(screen.getByText('修改 1 / 2')).toBeTruthy();
    expect(screen.getByText('旧结论')).toBeTruthy();
    expect(container.querySelectorAll('[data-diff-line="removed"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-diff-line="added"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /修改 1 · 修改/ }));
    expect(screen.queryByText('旧结论')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /修改 1 · 修改/ }));
    expect(screen.getByText('旧结论')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /下一处/ }));
    expect(screen.getByText('修改 2 / 2')).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('修改 2');
    fireEvent.click(screen.getByRole('button', { name: /上一处/ }));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('修改 1');
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });
  it('updates status from the conversation and removes the pending note banner', () => {
    const view = render(<Harness />);
    expect(screen.getByRole('region', { name: 'AI 待审阅修改' })).toBeTruthy();
    view.rerender(<Harness value={{ ...proposal, status: 'applied' }} />);
    expect(screen.queryByRole('region', { name: 'AI 待审阅修改' })).toBeNull();
    expect(screen.getByText(/已应用 · 历史修改快照/)).toBeTruthy();
  });
  it('shows missing base and failure explicitly without inventing a diff', () => {
    render(<Harness value={{ ...proposal, beforeMarkdown: null, status: 'error', error: '保存冲突' }} />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /下一处/ }).hasAttribute('disabled')).toBe(true);
  });
  it('is usable without a loaded record and does not leak records across workspaces', () => {
    const view = render(<Harness />);
    view.rerender(<NoteReviewProvider key="other-workspace" onOpen={vi.fn()} onShowAssistant={vi.fn()}>
      <NoteReviewPage proposalId="p" onOpenNote={vi.fn()} />
    </NoteReviewProvider>);
    expect(screen.getByRole('alert').textContent).toContain('尚未加载');
    expect(screen.queryByText('新结论')).toBeNull();
  });
});
