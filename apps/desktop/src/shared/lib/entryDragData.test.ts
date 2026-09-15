// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag, registerEntryTagDropTarget } from './entryDragData';

afterEach(() => { cancelEntryTagDrag(); vi.restoreAllMocks(); });

describe('visible entry tag drop targets', () => {
  it('does not drop on a row clipped or covered by the sidebar toolbar', () => {
    const row = document.createElement('div');
    const toolbar = document.createElement('div');
    const onDrop = vi.fn();
    const unregister = registerEntryTagDropTarget({ element: row, onDrop });
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200, top: 0, bottom: 50 } as DOMRect);
    const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    const hit = vi.fn((): Element | null => toolbar);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
    try {
      beginEntryTagDrag('paper', 20, 20);
      finishEntryTagDrag(20, 20);
      expect(onDrop).not.toHaveBeenCalled();
      hit.mockReturnValue(row);
      beginEntryTagDrag('paper', 20, 20);
      finishEntryTagDrag(20, 20);
      expect(onDrop).toHaveBeenCalledExactlyOnceWith('paper');
      hit.mockReturnValue(null);
      beginEntryTagDrag('paper', 20, 20);
      finishEntryTagDrag(20, 20);
      expect(onDrop).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
      if (original) Object.defineProperty(document, 'elementFromPoint', original);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
});
