/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { ChatMessage } from './ChatMessage';

afterEach(cleanup);
const proposal: AssistantNoteProposal = {
  id: 'p', entryId: 'e', entryTitle: 'Paper', noteId: 'n', title: 'Note',
  action: 'replace', beforeMarkdown: 'Old', markdown: 'New', sources: [],
  createdAt: '', status: 'pending', targetKind: 'markdown_note'
};
function show(overrides: Partial<AssistantNoteProposal>) {
  const value = { ...proposal, ...overrides };
  const apply = vi.fn(); const reject = vi.fn();
  render(<ChatMessage message={{ message_id: 'm', role: 'assistant', content: '', created_at: '', source_links: [] }}
    noteProposals={[value]} streaming={false} onOpenSource={vi.fn()}
    onApplyNoteProposal={apply} onRejectNoteProposal={reject} />);
  return { value, apply, reject };
}

it.each<Partial<AssistantNoteProposal>>([
  { beforeMarkdown: null },
  { action: 'patch', patchOperations: [{ type: 'replace_exact', oldText: 'Missing', newText: 'New' }] }
])('blocks confirmation of an unreviewable proposal but still allows ignoring it: %j', overrides => {
  const { value, apply, reject } = show(overrides);
  const confirm = screen.getByRole('button', { name: '确认' });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  expect(confirm.title).toContain('无法可靠对比');
  fireEvent.click(confirm);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '忽略' }));
  expect(reject).toHaveBeenCalledExactlyOnceWith(value);
});

it.each<Partial<AssistantNoteProposal>>([
  {},
  { status: 'error', error: 'Temporary failure' },
  { action: 'create', beforeMarkdown: null, noteId: null },
  { targetKind: 'segment_note', beforeMarkdown: null, segmentUid: 'segment-1' }
])('keeps valid, retryable, new and segment proposals confirmable: %j', overrides => {
  const { value, apply } = show(overrides);
  const confirm = screen.getByRole('button', { name: '确认' });
  expect(confirm.hasAttribute('disabled')).toBe(false);
  fireEvent.click(confirm);
  expect(apply).toHaveBeenCalledExactlyOnceWith(value);
});
