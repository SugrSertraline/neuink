// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginEntryTagDrag, cancelEntryTagDrag, getEntryTagDragState } from '@/shared/lib/entryDragData';
import { useTagNavigationDragScroll } from './useTagNavigationDragScroll';

afterEach(() => { cleanup(); cancelEntryTagDrag(); vi.restoreAllMocks(); });

function Surface() {
  const ref = useRef<HTMLDivElement>(null);
  useTagNavigationDragScroll(ref);
  return <div data-slot="scroll-area-viewport" data-testid="viewport"><div ref={ref} /></div>;
}

describe('tag sidebar drag edge scrolling', () => {
  it('scrolls only the sidebar at its edges under UI scaling and cleans up on cancel and unmount', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    const view = render(<Surface />);
    const viewport = view.getByTestId('viewport');
    Object.defineProperties(viewport, { offsetHeight: { value: 400 }, clientHeight: { value: 400 }, scrollHeight: { value: 1000 } });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 250, top: 0, bottom: 500, height: 500 } as DOMRect);
    const tick = () => act(() => { const [id, callback] = [...frames][0]; frames.delete(id); callback(0); });
    act(() => beginEntryTagDrag('entry', 100, 490));
    tick();
    expect(viewport.scrollTop).toBe(8);
    expect(getEntryTagDragState()?.entryId).toBe('entry');
    act(() => beginEntryTagDrag('entry', 300, 490));
    tick();
    expect(viewport.scrollTop).toBe(8);
    act(() => cancelEntryTagDrag());
    expect(frames.size).toBe(0);
    act(() => beginEntryTagDrag('entry', 100, 10));
    tick();
    expect(viewport.scrollTop).toBe(0);
    view.unmount();
    expect(frames.size).toBe(0);
  });
});
