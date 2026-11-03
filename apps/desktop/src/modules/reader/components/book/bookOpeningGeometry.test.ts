import { expect, it } from 'vitest';
import { openingBookOffset } from './bookOpeningGeometry';

it.each([180, 240, 300])('keeps the visible book centered throughout opening at width %s', width => {
  const center = 600, perspective = 1600;
  for (const degrees of [0, 30, 60, 85, 90, 110, 135, 158]) {
    const angle = degrees * Math.PI / 180;
    const x = center - width / 2 + openingBookOffset(width, degrees, perspective);
    const projection = perspective / (perspective - width * Math.sin(angle));
    const coverEdge = center + (x + width * Math.cos(angle) - center) * projection;
    const left = Math.min(x, coverEdge), right = Math.max(x + width, coverEdge);
    expect((left + right) / 2).toBeCloseTo(center, 6);
  }
});
