import { expect, it } from 'vitest';
import { cornerCurlPoint } from './cornerCurlGeometry';

it('lifts the bottom-right corner first while the top edge and binding remain on the paper', () => {
  expect(cornerCurlPoint(400, 600, 400, 600, .1).z).toBeGreaterThan(0);
  expect(cornerCurlPoint(400, 0, 400, 600, .1)).toEqual({ x: 400, y: 0, z: 0 });
  expect(cornerCurlPoint(200, 300, 400, 600, .1)).toEqual({ x: 200, y: 300, z: 0 });
  expect(cornerCurlPoint(0, 600, 400, 600, .1)).toEqual({ x: 0, y: 600, z: 0 });
});
it('deposits a flat reverse page with unchanged page height and a fixed binding', () => {
  for (const x of [0, 20, 200, 400]) for (const y of [0, 300, 600]) {
    expect(cornerCurlPoint(x, y, 400, 600, 0)).toEqual({ x, y, z: 0 });
    expect(cornerCurlPoint(x, y, 400, 600, 1)).toEqual({ x: -x, y, z: 0 });
  }
});
it('has a continuous crease and finite, bounded curvature for tall and wide pages', () => {
  for (const [w, h] of [[400, 600], [600, 400]]) for (let p = .05; p < 1; p += .05) {
    for (let y = 0; y <= h; y += 40) for (let x = 0; x < w; x += 10) {
      const a = cornerCurlPoint(x, y, w, h, p), b = cornerCurlPoint(x + .1, y, w, h, p);
      expect(Number.isFinite(a.x + a.y + a.z)).toBe(true);
      expect(a.z).toBeGreaterThanOrEqual(0);
      // Local paper distances are preserved around the diagonal cylinder.
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(.1, 3);
    }
  }
});
