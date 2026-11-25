import { describe, expect, it, vi } from 'vitest';

import {
  discardSegmentEditorsBeforeClose,
  hasUnsavedSegmentEditors,
  hasUnsavedEntrySegmentEditors,
  registerSegmentEditorCloseHandler,
  saveSegmentEditorsBeforeClose,
  saveEntrySegmentEditorsBeforeCopy,
  setSegmentEditorDirty
} from './segmentEditorDirtyRegistry';

describe('segmentEditorDirtyRegistry', () => {
  it('saves the source entry across nested readers before copying and leaves unrelated edits alone', async () => {
    const scopes = ['pdf:copy-source/editor', 'tag-reading:tag/reflow:copy-source', 'pdf:copy-source-other'];
    const saves = scopes.map(() => vi.fn(async () => true));
    const unregister = scopes.map((scope, i) => registerSegmentEditorCloseHandler(scope, 'note', { discard: vi.fn(), save: saves[i] }));
    scopes.forEach(scope => setSegmentEditorDirty(scope, 'note', true));
    expect(await saveEntrySegmentEditorsBeforeCopy('copy-source')).toBe(true);
    expect(saves[0]).toHaveBeenCalledOnce(); expect(saves[1]).toHaveBeenCalledOnce(); expect(saves[2]).not.toHaveBeenCalled();
    expect(hasUnsavedSegmentEditors(scopes[2])).toBe(true);
    scopes.forEach(scope => discardSegmentEditorsBeforeClose(scope)); unregister.forEach(fn => fn());
  });
  it('blocks copying if a source editor cannot save', async () => {
    const scope = 'entry-overview:copy-failure';
    const unregister = registerSegmentEditorCloseHandler(scope, 'fields', { discard: vi.fn(), save: async () => false });
    setSegmentEditorDirty(scope, 'fields', true);
    expect(await saveEntrySegmentEditorsBeforeCopy('copy-failure')).toBe(false);
    expect(hasUnsavedEntrySegmentEditors('copy-failure')).toBe(true);
    discardSegmentEditorsBeforeClose(scope); unregister();
  });
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
