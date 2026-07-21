// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
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

    fireEvent.click(getByRole('button', { name: '应用' }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(value);
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
