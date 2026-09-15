import { describe, expect, it } from 'vitest';

import {
  clampWorkspaceSplitLeftWidth,
  getWorkspaceSplitMinimums,
  getWorkspaceSplitWidthBounds,
  WORKSPACE_SPLIT_DIVIDER_WIDTH,
  WORKSPACE_SPLIT_MIN_RESIZE_RANGE
} from './workspaceSplit';

describe('workspace split sizing', () => {
  it('preserves the standard 320px minimum when space is available', () => {
    expect(getWorkspaceSplitWidthBounds(1000)).toEqual({
      minLeftWidth: 320,
      maxLeftWidth: 670
    });
    expect(clampWorkspaceSplitLeftWidth(120, 1000)).toBe(320);
    expect(clampWorkspaceSplitLeftWidth(900, 1000)).toBe(670);
  });

  it('lets a Markdown note use a narrower pane without shrinking the reader contract', () => {
    const noteOnRight = getWorkspaceSplitMinimums(
      { kind: 'pdf', entryId: 'entry-1' },
      { kind: 'note', entryId: 'entry-1', noteId: 'note-1' }
    );
    const noteOnLeft = getWorkspaceSplitMinimums(
      { kind: 'note', entryId: 'entry-1', noteId: 'note-1' },
      { kind: 'reflow', entryId: 'entry-1' }
    );

    expect(noteOnRight).toEqual({ left: 320, right: 224 });
    expect(clampWorkspaceSplitLeftWidth(900, 1000, noteOnRight)).toBe(766);
    expect(noteOnLeft).toEqual({ left: 224, right: 320 });
    expect(clampWorkspaceSplitLeftWidth(120, 1000, noteOnLeft)).toBe(224);
  });

  it('shrinks panes proportionally while keeping the divider operable in a narrow workspace', () => {
    const containerWidth = 500;
    const minimums = { left: 224, right: 320 };
    const bounds = getWorkspaceSplitWidthBounds(containerWidth, minimums);
    const leftAtMinimum = clampWorkspaceSplitLeftWidth(0, containerWidth, minimums);
    const leftAtMaximum = clampWorkspaceSplitLeftWidth(900, containerWidth, minimums);
    const rightAtMaximum = containerWidth - WORKSPACE_SPLIT_DIVIDER_WIDTH - leftAtMaximum;

    expect(bounds).toEqual({ minLeftWidth: 162, maxLeftWidth: 258 });
    expect(leftAtMaximum - leftAtMinimum).toBe(WORKSPACE_SPLIT_MIN_RESIZE_RANGE);
    expect(rightAtMaximum).toBe(232);
  });

  it('keeps useful horizontal travel when target minimums only just fit', () => {
    const bounds = getWorkspaceSplitWidthBounds(650);

    expect(bounds).toEqual({ minLeftWidth: 272, maxLeftWidth: 368 });
    expect(clampWorkspaceSplitLeftWidth(280, 650)).toBe(280);
    expect(clampWorkspaceSplitLeftWidth(350, 650)).toBe(350);
  });
});
