import { describe, expect, it } from 'vitest';
import { createGlassMap } from './glassOptics';

describe('bounded backdrop displacement', () => {
  it('leaves the reading centre neutral and bends only near the perimeter', () => {
    const map = createGlassMap(120, 60, 8);
    const channel = (x: number, y: number, c: number) => map.pixels[(y * map.width + x) * 4 + c];
    expect(channel(60, 30, 0)).toBe(128);
    expect(channel(60, 30, 1)).toBe(128);
    expect(channel(5, 30, 0)).toBeLessThan(40);
    expect(channel(114, 30, 0)).toBeGreaterThan(216);
    expect(channel(5, 30, 1)).toBe(128);
    expect(channel(60, 5, 1)).toBeLessThan(40);
  });
  it('has symmetric, opaque edges without altering the axis parallel to a straight edge', () => {
    const { pixels, width, height } = createGlassMap(100, 50, 10);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, mirror = (y * width + width - x - 1) * 4;
      expect(pixels[i] + pixels[mirror]).toBe(256);
      expect(pixels[i + 1]).toBe(pixels[mirror + 1]);
      expect(pixels[i + 3]).toBe(255);
    }
  });
  it('bounds raster cost at large window sizes and tolerates collapsed geometry', () => {
    expect(createGlassMap(8000, 4000, 999).pixels.length).toBe(384 * 192 * 4);
    expect(createGlassMap(0, 0, -10).pixels.length).toBe(4);
  });
});
