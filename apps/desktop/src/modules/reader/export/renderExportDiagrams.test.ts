// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { rasterDimensions, renderExportDiagrams } from './renderExportDiagrams';

vi.mock('@/shared/lib/mermaidRenderer', () => ({ renderMermaidSvg: vi.fn().mockRejectedValue(new Error('bad private source')) }));

describe('paper diagram rasterization', () => {
  it('preserves aspect ratio and bounds the canvas', () => {
    expect(rasterDimensions(200, 100)).toEqual({ width: 400, height: 200 });
    expect(rasterDimensions(20000, 10000)).toEqual({ width: 4096, height: 2048 });
    const square = rasterDimensions(20000, 20000);
    expect(square.width * square.height).toBeLessThanOrEqual(12_001_000);
  });
  it('rejects invalid dimensions', () => {
    for (const width of [0, -1, Infinity, NaN]) expect(() => rasterDimensions(width, 30)).toThrow();
  });
  it('reports the failing page without leaking parser messages or continuing', async () => {
    const progress = vi.fn();
    await expect(renderExportDiagrams([{ id: 'x', segment_uid: 's', page: 8, code: 'bad' }], progress))
      .rejects.toThrow('第 8 页流程图 1 无法安全渲染');
    expect(progress).toHaveBeenCalledWith('正在渲染流程图 1 / 1…');
  });
});
