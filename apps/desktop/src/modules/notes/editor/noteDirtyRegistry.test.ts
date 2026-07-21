import { afterEach, describe, expect, it } from 'vitest';

import {
  clearMarkdownNoteDirty,
  hasUnsavedMarkdownNote,
  setMarkdownNoteDirty
} from './noteDirtyRegistry';

const entryId = 'entry-dirty-test';
const noteId = 'note-dirty-test';

afterEach(() => clearMarkdownNoteDirty(entryId, noteId));

describe('noteDirtyRegistry', () => {
  it('clears stale dirty owners after the note has been persisted', () => {
    setMarkdownNoteDirty(entryId, noteId, 'old-pane', true);
    setMarkdownNoteDirty(entryId, noteId, 'active-pane', true);

    clearMarkdownNoteDirty(entryId, noteId);

    expect(hasUnsavedMarkdownNote(entryId, noteId)).toBe(false);
  });
});
