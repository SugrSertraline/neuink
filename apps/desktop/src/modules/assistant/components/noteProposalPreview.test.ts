import { describe, expect, it } from 'vitest';

import type { AssistantNoteProposal } from '@/shared/types/assistant';

import { buildNoteProposalPreview } from './noteProposalPreview';

describe('buildNoteProposalPreview', () => {
  it('shows only added Markdown for append proposals', () => {
    const preview = buildNoteProposalPreview(proposal({
      action: 'append',
      afterMarkdown: '# Existing\n\nNew paragraph',
      beforeMarkdown: '# Existing',
      markdown: 'New paragraph'
    }));

    expect(preview).toEqual({
      kind: 'change', label: 'Added', text: 'New paragraph', tone: 'after'
    });
  });

  it('shows only added Markdown for prepend proposals', () => {
    const preview = buildNoteProposalPreview(proposal({
      action: 'prepend',
      afterMarkdown: 'New paragraph\n\n# Existing',
      beforeMarkdown: '# Existing',
      markdown: 'New paragraph'
    }));

    expect(preview).toEqual({
      kind: 'change', label: 'Added', text: 'New paragraph', tone: 'after'
    });
  });

  it('shows only removed Markdown for delete patches', () => {
    const preview = buildNoteProposalPreview(proposal({
      action: 'patch',
      afterMarkdown: '# Note',
      beforeMarkdown: '# Note\n\nRemove me',
      markdown: '# Note',
      patchOperations: [{ newText: '', oldText: 'Remove me', type: 'replace_exact' }]
    }));

    expect(preview).toEqual({
      kind: 'change', label: 'Removed', text: 'Remove me', tone: 'before'
    });
  });

  it('recognizes a deletion from whole-note before and after snapshots', () => {
    const preview = buildNoteProposalPreview(proposal({
      action: 'patch',
      afterMarkdown: '# Note\n\nKeep me',
      beforeMarkdown: '# Note\n\nRemove me\n\nKeep me',
      markdown: '# Note\n\nKeep me',
      patchOperations: [{
        newText: '# Note\n\nKeep me',
        oldText: '# Note\n\nRemove me\n\nKeep me',
        type: 'replace_exact'
      }]
    }));

    expect(preview).toEqual({
      kind: 'change', label: 'Removed', text: 'Remove me', tone: 'before'
    });
  });

  it('keeps local before and after context for mixed edits', () => {
    const preview = buildNoteProposalPreview(proposal({
      action: 'patch',
      afterMarkdown: 'one\ntwo changed\nthree',
      beforeMarkdown: 'one\ntwo\nthree',
      markdown: 'one\ntwo changed\nthree'
    }));

    expect(preview.kind).toBe('diff');
    if (preview.kind === 'diff') {
      expect(preview.before).toContain('two');
      expect(preview.after).toContain('two changed');
    }
  });
});

function proposal(
  patch: Partial<AssistantNoteProposal> & Pick<AssistantNoteProposal, 'action' | 'markdown'>
): AssistantNoteProposal {
  return {
    createdAt: '', entryId: 'entry-1', entryTitle: 'Paper', id: 'proposal-1',
    sources: [], status: 'pending', title: 'Note', ...patch
  };
}
