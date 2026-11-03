// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantEntryMetaProposal } from '@/shared/types/assistant';

import { EntryMetaProposalCard } from './EntryMetaProposalCard';

afterEach(cleanup);

describe('EntryMetaProposalCard', () => {
  it('shows title and description changes without applying them automatically', () => {
    const onApply = vi.fn();
    const { getByText } = render(
      <EntryMetaProposalCard
        onApply={onApply}
        onOpenSource={() => undefined}
        proposal={proposal()}
      />
    );

    expect(getByText('Original title')).toBeTruthy();
    expect(getByText('Grounded title')).toBeTruthy();
    expect(getByText('Original description')).toBeTruthy();
    expect(getByText('Grounded description')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('sends the exact proposal only after Apply is clicked', () => {
    const onApply = vi.fn();
    const value = proposal();
    const { getByRole } = render(
      <EntryMetaProposalCard
        onApply={onApply}
        onOpenSource={() => undefined}
        proposal={value}
      />
    );

    fireEvent.click(getByRole('button', { name: '确认应用' }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(value);
  });

  it('keeps the complete comparison reviewable and separates source navigation from the decision', () => {
    const value: AssistantEntryMetaProposal = {
      ...proposal(),
      entryTitle: '1-s2.0-S0278612526000762-main',
      beforeTitle: '1-s2.0-S0278612526000762-main',
      afterTitle: 'Digital twin-driven key events and product quality prediction for time-varying manufacturing system',
      beforeDescription: '',
      afterDescription: `完整描述\nhttps://example.com/${'long-paper-identifier'.repeat(20)}`,
      sources: [{ entryId: 'entry-1', entryTitle: '论文原文', segmentUid: 'segment-1',
        pageIdx: 0, quote: '标题来自论文第一页。', marker: 'S2' }]
    };
    const onApply = vi.fn(); const onReject = vi.fn(); const onOpenSource = vi.fn();
    const view = render(<EntryMetaProposalCard proposal={value} onApply={onApply}
      onReject={onReject} onOpenSource={onOpenSource} />);
    const title = within(view.getByRole('region', { name: '标题修改对比' }));
    const description = within(view.getByRole('region', { name: '描述修改对比' }));
    expect(view.getByText(`条目：${value.entryTitle}`)).toBeTruthy();
    expect(title.getByText(value.beforeTitle).textContent).toBe(value.beforeTitle);
    expect(title.getByText(value.afterTitle).textContent).toBe(value.afterTitle);
    expect(description.getByText('（空）')).toBeTruthy();
    expect(description.getByText(value.afterDescription, { normalizer: text => text }).textContent).toBe(value.afterDescription);

    fireEvent.click(view.getByRole('button', { name: 'S2 · p.1' }));
    expect(onOpenSource).toHaveBeenCalledExactlyOnceWith({ entry_id: 'entry-1', entry_title: '论文原文',
      segment_uid: 'segment-1', page_idx: 0, quote: '标题来自论文第一页。' });
    expect(onApply).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: '拒绝' }));
    expect(onReject).toHaveBeenCalledExactlyOnceWith(value);
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each([{ disabled: true }, { deciding: true }])('blocks duplicate decisions while unavailable: %j', state => {
    const onApply = vi.fn(); const onReject = vi.fn();
    const view = render(<EntryMetaProposalCard {...state} proposal={proposal()} onApply={onApply}
      onReject={onReject} onOpenSource={vi.fn()} />);
    for (const name of ['拒绝', '确认应用']) {
      const button = view.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.click(button);
    }
    if ('deciding' in state) expect(view.getByText('正在提交')).toBeTruthy();
    expect(view.getByText('Grounded title')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it.each([
    ['applied', '已应用'], ['rejected', '已拒绝'], ['applying', '待核对结果'], ['error', '未完成，请核对']
  ] as const)('keeps the comparison after %s without offering another decision', (status, label) => {
    const view = render(<EntryMetaProposalCard proposal={{ ...proposal(), status }}
      onApply={vi.fn()} onReject={vi.fn()} onOpenSource={vi.fn()} />);
    expect(view.getByText(label)).toBeTruthy();
    expect(view.getByText('Original title')).toBeTruthy();
    expect(view.getByText('Grounded title')).toBeTruthy();
    expect(view.queryByRole('button', { name: '确认应用' })).toBeNull();
    expect(view.queryByRole('button', { name: '拒绝' })).toBeNull();
  });
});

function proposal(): AssistantEntryMetaProposal {
  return {
    afterDescription: 'Grounded description',
    afterTitle: 'Grounded title',
    baseUpdatedAt: '2026-07-14T00:00:00Z',
    beforeDescription: 'Original description',
    beforeTitle: 'Original title',
    createdAt: '2026-07-14T00:00:00Z',
    entryId: 'entry-1',
    entryTitle: 'Original title',
    fields: ['title', 'description'],
    id: 'entry-meta-proposal-1',
    rationale: 'Derived from the paper.',
    sources: [],
    status: 'pending'
  };
}
