// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GuideInteractionShield, guideBlockedRects } from './GuideInteractionShield';

afterEach(cleanup);
const contains = (rect: { x:number; y:number; width:number; height:number }, x:number, y:number) =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

describe('guide hit-testing shield', () => {
  it('covers the viewport while loading and opens exactly the union of overlapping highlights', () => {
    expect(guideBlockedRects(100, 80, [])).toEqual([{ x:0, y:0, width:100, height:80 }]);
    const windows = [
      { x:10, y:10, width:30, height:30 }, { x:25, y:25, width:50, height:25 },
      { x:-10, y:65, width:40, height:40 }, { x:200, y:0, width:10, height:10 },
    ];
    const blocked = guideBlockedRects(100, 80, windows);
    // No gap and no double blocking, including popup/content intersections and clipped windows.
    for (let x = 0.5; x < 100; x++) for (let y = 0.5; y < 80; y++) {
      expect(blocked.filter(rect => contains(rect, x, y)).length).toBe(windows.some(rect => contains(rect, x, y)) ? 0 : 1);
    }
    expect(blocked.every(rect => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 100 && rect.y + rect.height <= 80)).toBe(true);
  });

  it('keeps CSS hover off the background through real pointer-catching surfaces', () => {
    const { container } = render(<GuideInteractionShield width={800} height={600}
      windows={[{ x:100, y:80, width:500, height:400 }]} />);
    const shields = [...container.querySelectorAll<HTMLElement>('[data-guide-interaction-shield]')];
    expect(shields).toHaveLength(4);
    expect(shields.every(element => element.classList.contains('pointer-events-auto') && element.style.touchAction === 'none')).toBe(true);
    expect(guideBlockedRects(0, 0, [])).toEqual([]);
  });
});
