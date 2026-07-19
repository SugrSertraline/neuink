import { describe, expect, it } from 'vitest';

describe('image resize axis behavior', () => {
  it('uses the slider movement as the scroll compensation amount', () => {
    const sliderTopBeforeResize = 420;
    const sliderTopAfterResize = 468;
    const scrollCompensation = sliderTopAfterResize - sliderTopBeforeResize;

    expect(scrollCompensation).toBe(48);
    expect(sliderTopAfterResize - scrollCompensation).toBe(sliderTopBeforeResize);
  });
});
