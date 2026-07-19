// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantTagProposal } from '@/shared/types/assistant';

import { TagProposalList } from './TagProposalList';

afterEach(cleanup);

describe('TagProposalList', () => {
  it('keeps long hierarchical tags wrap-safe inside a narrow assistant panel', () => {
    const proposal = createProposal();
    const onApply = vi.fn();
    const { container, getByRole, getByText } = render(
      <TagProposalList proposals={[proposal]} onApply={onApply} />
    );

    const title = getByText(`添加 Tag：${proposal.name} · 1 个 Entry`);
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
    expect(container.querySelector('.tag-proposal-list')).toBeTruthy();
    expect(container.querySelector('.tag-proposal-actions')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(proposal);
  });
});

function createProposal(): AssistantTagProposal {
  return {
    action: 'attach',
    createdAt: '2026-07-14T00:00:00.000Z',
    entryIds: ['entry-1'],
    id: 'tag-proposal-1',
    name: '计算机科学/人工智能/自主智能体/基于工具的复杂任务规划与执行',
    status: 'pending'
  };
}
