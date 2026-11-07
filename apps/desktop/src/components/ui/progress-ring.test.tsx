// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressRing } from './progress-ring';

const arc = (value: number) => {
  const { container } = render(<ProgressRing className="size-5" value={value} />);
  const circles = container.querySelectorAll('circle');
  expect(circles).toHaveLength(2);
  return { arcElement: circles[1] as SVGCircleElement, container };
};

describe('progress ring', () => {
  it('draws the arc in proportion to the value', () => {
    const half = arc(0.5);
    const circumference = Number(half.arcElement.getAttribute('stroke-dasharray'));
    expect(Number(half.arcElement.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.5);
    const full = arc(1);
    expect(Number(full.arcElement.getAttribute('stroke-dashoffset'))).toBe(0);
  });

  it('clamps out-of-range and unusable values instead of drawing outside the circle', () => {
    const over = arc(1.4);
    expect(Number(over.arcElement.getAttribute('stroke-dashoffset'))).toBe(0);
    const under = arc(-0.2);
    const circumference = Number(under.arcElement.getAttribute('stroke-dasharray'));
    expect(Number(under.arcElement.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference);
  });

  it('is decorative: the caller owns the accessible name', () => {
    const { container } = arc(Number.NaN);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-slot="progress-ring"]')).not.toBeNull();
  });
});
