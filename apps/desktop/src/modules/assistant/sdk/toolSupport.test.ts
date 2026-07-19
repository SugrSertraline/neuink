import { describe, expect, it } from 'vitest';

import {
  noteProposalAction,
  noteProposalInputSchema,
  prependMarkdownPreview
} from './toolSupport';

describe('prepend note proposals', () => {
  it('accepts prepend as a model-visible proposal action', () => {
    const schema = noteProposalInputSchema();
    const action = schema.properties?.action as { enum?: unknown[] };

    expect(action.enum).toContain('prepend');
    expect(noteProposalAction('prepend', {
      currentNote: null,
      hasPlannedMarkdownNote: true,
      targetKind: 'markdown_note'
    })).toBe('prepend');
  });

  it('places generated Markdown before the existing note', () => {
    expect(prependMarkdownPreview('# Existing\n\nBody\n', '# New\n')).toBe(
      '# New\n\n# Existing\n\nBody\n'
    );
  });
});
