import { describe, expect, it } from 'vitest';

import { calculateRailItemMotion } from './railMotion';

describe('calculateRailItemMotion', () => {
  it('keeps heading hierarchy visible without making body markers too short', () => {
    const body = idleMotion(false, null);
    const levelOne = idleMotion(true, 1);
    const levelTwo = idleMotion(true, 2);
    const levelThree = idleMotion(true, 3);

    expect(body.width).toBe(15);
    expect(levelOne.width).toBeGreaterThan(levelTwo.width);
    expect(levelTwo.width).toBeGreaterThan(levelThree.width);
    expect(levelThree.width - body.width).toBeLessThanOrEqual(5);
    expect(levelOne.width - body.width).toBeLessThanOrEqual(11);
  });

  it('magnifies the nearest marker and softly lifts its neighbors', () => {
    const nearest = hoverMotion(50, 260);
    const neighbor = hoverMotion(54, 260);
    const distant = hoverMotion(75, 260);

    expect(nearest.scaleX).toBeGreaterThan(neighbor.scaleX);
    expect(neighbor.scaleX).toBeGreaterThan(distant.scaleX);
    expect(nearest.scaleY).toBeGreaterThan(2);
    expect(nearest.shadow).not.toBe('none');
    expect(distant.scaleX).toBe(1);
  });
});

function idleMotion(isHeading: boolean, headingLevel: number | null) {
  return calculateRailItemMotion({
    headingLevel,
    isHeading,
    itemTopPercent: 50,
    pointerY: null,
    railHeight: 520,
    railWidth: 36
  });
}

function hoverMotion(itemTopPercent: number, pointerY: number) {
  return calculateRailItemMotion({
    headingLevel: null,
    isHeading: false,
    itemTopPercent,
    pointerY,
    railHeight: 520,
    railWidth: 36
  });
}
