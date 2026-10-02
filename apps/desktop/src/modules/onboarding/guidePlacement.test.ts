import { describe, expect, it } from 'vitest';
import type { SpotlightRect } from './useSpotlight';
import { placeGuidePanel, placeGuideTargetCue } from './guidePlacement';

const rect = (x: number, y: number, width: number, height: number,
  viewportWidth = 1200, viewportHeight = 800): SpotlightRect =>
  ({ x, y, width, height, viewportWidth, viewportHeight });

const overlap = (a: { left:number; top:number; width:number }, height:number, b: Pick<SpotlightRect, 'x' | 'y' | 'width' | 'height'>) =>
  Math.max(0, Math.min(a.left + a.width, b.x + b.width) - Math.max(a.left, b.x))
  * Math.max(0, Math.min(a.top + height, b.y + b.height) - Math.max(a.top, b.y));

describe('guide panel placement', () => {
  it('uses the dimmed right side when it has room', () => {
    const target = rect(16, 100, 60, 440);
    const panel = placeGuidePanel(target, [], 350, 1200, 800);
    expect(panel.left).toBe(88);
    expect(panel.width).toBe(390);
    expect(overlap(panel, 350, target)).toBe(0);
  });

  it('shrinks into the left dark strip instead of covering a wide PDF highlight', () => {
    const target = rect(316, 76, 588, 648);
    const panel = placeGuidePanel(target, [], 410, 1200, 800);
    expect(panel.left).toBe(12);
    expect(panel.width).toBe(292);
    expect(overlap(panel, 410, target)).toBe(0);
  });

  it('uses the lower dark band when neither side is wide enough', () => {
    const target = rect(90, 20, 620, 400, 800, 800);
    const panel = placeGuidePanel(target, [], 360, 800, 800);
    expect(panel.top).toBe(432);
    expect(panel.maxHeight).toBe(356);
    expect(overlap(panel, 360, target)).toBe(0);
  });

  it('avoids a highlighted popup when another dimmed position is clear', () => {
    const target = rect(316, 76, 588, 648);
    const popup = rect(0, 0, 310, 310);
    const panel = placeGuidePanel(target, [popup], 360, 1200, 800);
    expect(overlap(panel, 360, target)).toBe(0);
    expect(overlap(panel, 360, popup)).toBe(0);
  });

  it('keeps the panel on screen when the highlight leaves no usable dark region', () => {
    const target = rect(20, 20, 280, 160, 320, 200);
    const panel = placeGuidePanel(target, [], 300, 320, 200);
    expect(panel.left).toBeGreaterThanOrEqual(12);
    expect(panel.top).toBeGreaterThanOrEqual(12);
    expect(panel.left + panel.width).toBeLessThanOrEqual(308);
    expect(panel.top + Math.min(300, panel.maxHeight)).toBeLessThanOrEqual(188);
  });

  it('places a control label beside the target and keeps the guide panel clear of it', () => {
    const navigation = rect(4, 44, 40, 40);
    const cue = placeGuideTargetCue(navigation, '条目库');
    expect(cue).toMatchObject({ x:52, y:50, height:28 });
    const panel = placeGuidePanel(rect(0, 36, 52, 728), [cue!], 390, 1200, 800);
    expect(overlap(panel, 390, cue!)).toBe(0);
  });

  it('puts a control label on the left when there is no space on the right', () => {
    const cue = placeGuideTargetCue(rect(880, 80, 280, 36), '选择元素');
    expect(cue).not.toBeNull();
    expect(cue!.x + cue!.width).toBeLessThanOrEqual(880);
    expect(cue!.y).toBeGreaterThanOrEqual(8);
  });
});
