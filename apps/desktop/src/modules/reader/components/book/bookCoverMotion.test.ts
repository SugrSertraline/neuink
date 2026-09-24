// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookCoverMotion } from './bookCoverMotion';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('continuous shelf cover motion', () => {
  it('reveals depth even when the pointer stays still on entry or focus', () => {
    const host=document.createElement('div'), stage=createBookCoverMotion(host);
    vi.advanceTimersByTime(16);
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('-22.00deg');
    expect(host.style.getPropertyValue('--book-tilt-x')).toBe('6.00deg');
    expect(vi.getTimerCount()).toBe(0);
    stage.dispose();
  });
  it('coalesces pointer updates, caps tilt and stops work when the pointer is still', () => {
    const host=document.createElement('div'), stage=createBookCoverMotion(host);
    stage.point(.5, .5); stage.point(100, -100);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(16);
    expect(host.style.getPropertyValue('--book-tilt-x')).toBe('14.00deg');
    expect(host.style.getPropertyValue('--book-tilt-y')).toBe('-8.00deg');
    expect(host.style.getPropertyValue('--book-rim-gain')).toBe('12.00%');
    expect(vi.getTimerCount()).toBe(0);
    stage.rest(); expect(host.getAttribute('style')).toBe('');
    stage.dispose();
  });
  it('cancels pending pointer work when returning to rest or disposing', () => {
    const host=document.createElement('div'), stage=createBookCoverMotion(host);
    stage.point(1, 1); stage.rest(); vi.advanceTimersByTime(1000);
    expect(host.style.length).toBe(0);
    stage.point(1, 1); stage.dispose(); stage.point(1, 1); vi.advanceTimersByTime(1000);
    expect(host.style.length).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
