// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getGuideVisibleBounds, measureGuideSpotlight } from './guideGeometry';
import { findSpotlightTarget } from './useSpotlight';

const box = (left:number, top:number, width:number, height:number) =>
  ({ left, top, right:left + width, bottom:top + height, width, height } as DOMRect);
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    if (this.dataset.clip !== undefined) return box(100, 60, 600, 360);
    if (this.dataset.page !== undefined) return box(120, 20, 500, 720);
    if (this.dataset.cue !== undefined) return box(200, 450, 100, 24);
    return box(0, 0, 1200, 800);
  });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it('clips page spotlights to their actual scroll pane instead of the whole app', () => {
  document.body.innerHTML = '<div data-clip="scroll" style="overflow-y:auto"><div data-page="pdf"></div></div><div data-viewport></div>';
  const page = document.querySelector<HTMLElement>('[data-page]')!;
  const viewport = document.querySelector<HTMLElement>('[data-viewport]')!;
  expect(measureGuideSpotlight(page, viewport)).toMatchObject({ x:116, y:60, width:508, height:360 });
  expect(getGuideVisibleBounds(page, viewport)).toMatchObject({ top:60, bottom:420, height:360 });
});

it('rejects a cue scrolled behind its pane, even though it still intersects the app viewport', () => {
  document.body.innerHTML = '<div data-clip="scroll" style="overflow:auto"><button data-cue>复制链接</button></div><div data-viewport></div>';
  const cue = document.querySelector<HTMLElement>('[data-cue]')!;
  const viewport = document.querySelector<HTMLElement>('[data-viewport]')!;
  expect(measureGuideSpotlight(cue, viewport)).toBeNull();
  expect(findSpotlightTarget('[data-cue]', viewport)).toBeUndefined();
});

it('chooses the visible instance rather than a retained but clipped reader', () => {
  document.body.innerHTML = '<div data-clip="scroll" style="overflow:hidden"><div data-cue data-target>后台页面</div></div>'
    + '<div data-page data-target>当前页面</div><div data-viewport></div>';
  const viewport = document.querySelector<HTMLElement>('[data-viewport]')!;
  expect(findSpotlightTarget('[data-target]', viewport)?.textContent).toBe('当前页面');
});

it('does not authorize hidden ancestors or closed retained tabs with stale nonzero bounds', () => {
  document.body.innerHTML = '<div aria-hidden="true"><div data-page data-target>隐藏页面</div></div>'
    + '<div data-state="closed"><div data-page data-target>关闭页面</div></div><div data-viewport></div>';
  const viewport = document.querySelector<HTMLElement>('[data-viewport]')!;
  expect(findSpotlightTarget('[data-target]', viewport)).toBeUndefined();
});

it('preserves geometry when a Radix menu hides the background only from assistive technology', () => {
  document.body.innerHTML = '<div aria-hidden="true" data-aria-hidden="true"><div data-page data-target>可见背景页面</div></div><div data-viewport></div>';
  const viewport = document.querySelector<HTMLElement>('[data-viewport]')!;
  expect(findSpotlightTarget('[data-target]', viewport)?.textContent).toBe('可见背景页面');
});
