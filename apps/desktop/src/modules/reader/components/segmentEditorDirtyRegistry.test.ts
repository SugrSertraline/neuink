import { describe, expect, it, vi } from 'vitest';

import {
  discardSegmentEditorsBeforeClose,
  hasUnsavedSegmentEditors,
  registerSegmentEditorCloseHandler,
  saveSegmentEditorsBeforeClose,
  setSegmentEditorDirty
} from './segmentEditorDirtyRegistry';

describe('segmentEditorDirtyRegistry', () => {
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
