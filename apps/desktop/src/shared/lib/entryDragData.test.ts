// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginEntryTagDrag,
  cancelEntryTagDrag,
  finishEntryTagDrag,
  getEntryTagDragState,
  isEntryTagDropTargetActive,
  registerEntryTagDropTarget,
  updateEntryTagDrag
} from './entryDragData';

afterEach(() => cancelEntryTagDrag());

describe('entry tag drag', () => {
  it('highlights and commits the tag target below the pointer', () => {
    const element = document.createElement('div');
    const onDrop = vi.fn();
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 120, 28));
    const unregister = registerEntryTagDropTarget({ element, onDrop });

    beginEntryTagDrag('entry-42', 120, 60);

    expect(isEntryTagDropTargetActive(element)).toBe(true);
    updateEntryTagDrag(140, 68);
    expect(getEntryTagDragState()).toMatchObject({ entryId: 'entry-42', x: 140, y: 68 });

    finishEntryTagDrag(140, 68);

    expect(onDrop).toHaveBeenCalledWith('entry-42');
    expect(getEntryTagDragState()).toBeNull();
    unregister();
  });

  it('does not commit when released outside a tag target', () => {
    const onDrop = vi.fn();
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 120, 28));
    const unregister = registerEntryTagDropTarget({ element, onDrop });

    beginEntryTagDrag('entry-42', 20, 20);
    finishEntryTagDrag(20, 20);

    expect(onDrop).not.toHaveBeenCalled();
    unregister();
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}
