import { describe, expect, it, vi } from 'vitest';

import {
  discardSegmentEditorsBeforeClose,
  hasUnsavedSegmentEditors,
  hasUnsavedEntrySegmentEditors,
  registerSegmentEditorCloseHandler,
  saveSegmentEditorsBeforeClose,
  setSegmentEditorDirty
} from './segmentEditorDirtyRegistry';

describe('segmentEditorDirtyRegistry', () => {
  it('aggregates both nested readers without touching another tag workspace', async () => {
    const a = 'tag-reading:tag/pdf:entry-a'; const b = 'tag-reading:tag/reflow:entry-b';
    const other = 'tag-reading:other/pdf:entry-a';
    const disposers = [a, b, other].map((scope) => registerSegmentEditorCloseHandler(scope, 'note', { discard: vi.fn(), save: async () => scope !== b }));
    [a, b, other].forEach((scope) => setSegmentEditorDirty(scope, 'note', true));
    expect(hasUnsavedSegmentEditors('tag-reading:tag')).toBe(true);
    expect(hasUnsavedEntrySegmentEditors('entry-b')).toBe(true);
    expect(await saveSegmentEditorsBeforeClose('tag-reading:tag')).toBe(false);
    expect(hasUnsavedSegmentEditors(other)).toBe(true);
    discardSegmentEditorsBeforeClose('tag-reading:tag');
    expect(hasUnsavedSegmentEditors(b)).toBe(false);
    expect(hasUnsavedSegmentEditors(other)).toBe(true);
    discardSegmentEditorsBeforeClose(other);
    disposers.forEach((dispose) => dispose());
  });
  it.each([['pdf', 'pdf'], ['reflow', 'reflow'], ['segment-notes', 'segment-records']])('normalizes the real legacy %s editor scope for closing and export', async (legacy, canonical) => {
    const scope = `entry-content:legacy-${legacy}|${legacy}`;
    const canonicalScope = `${canonical}:legacy-${legacy}`;
    const unregister = registerSegmentEditorCloseHandler(scope, 'owner', { discard: vi.fn(), save: async () => true });
    setSegmentEditorDirty(scope, 'owner', true);
    expect(hasUnsavedSegmentEditors(canonicalScope)).toBe(true);
    expect(hasUnsavedEntrySegmentEditors(`legacy-${legacy}`)).toBe(true);
    expect(await saveSegmentEditorsBeforeClose(canonicalScope)).toBe(true);
    expect(hasUnsavedSegmentEditors(scope)).toBe(false);
    unregister();
  });

  it('keeps newer edits dirty even when a snapshot was saved successfully', async () => {
    const scope = 'pdf:new-edit';
    const unregister = registerSegmentEditorCloseHandler(scope, 'owner', { discard: vi.fn(), save: async () => true, isDirty: () => true });
    setSegmentEditorDirty(scope, 'owner', true);
    expect(await saveSegmentEditorsBeforeClose(scope)).toBe(false);
    expect(hasUnsavedSegmentEditors(scope)).toBe(true);
    discardSegmentEditorsBeforeClose(scope);
    unregister();
  });
  it('saves only dirty editors before closing a surface', async () => {
    const scope = 'pdf:entry-save';
    const save = vi.fn().mockResolvedValue(true);
    const unregister = registerSegmentEditorCloseHandler(scope, 'note', {
      discard: vi.fn(),
      save
    });
    setSegmentEditorDirty(scope, 'note', true);

    expect(hasUnsavedSegmentEditors(scope)).toBe(true);
    expect(await saveSegmentEditorsBeforeClose(scope)).toBe(true);
    expect(save).toHaveBeenCalledOnce();

    setSegmentEditorDirty(scope, 'note', false);
    unregister();
  });

  it('discards dirty editors without saving them', () => {
    const scope = 'segment-records:entry-discard';
    const discard = vi.fn();
    const save = vi.fn().mockResolvedValue(true);
    const unregister = registerSegmentEditorCloseHandler(scope, 'annotation', {
      discard,
      save
    });
    setSegmentEditorDirty(scope, 'annotation', true);

    discardSegmentEditorsBeforeClose(scope);

    expect(discard).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(hasUnsavedSegmentEditors(scope)).toBe(false);
    unregister();
  });
});
