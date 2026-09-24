// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { observeReadingWidth } from './observeReadingWidth';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('restores the pre-wrap segment, ignores resize scroll, and releases observers on cleanup', () => {
  vi.useFakeTimers();
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  const element = document.createElement('div');
  let width = 800; Object.defineProperty(element, 'clientWidth', { get: () => width });
  const position = { pageIdx: 7, segmentUid: 'paragraph-72', offset: .4, left: 0 };
  const adapter = { capture: vi.fn(() => position), restore: vi.fn(), navigate: vi.fn() };
  const stop = observeReadingWidth(element, adapter);
  width = 400;
  element.dispatchEvent(new Event('scroll'));
  expect(adapter.capture).toHaveBeenCalledTimes(1);
  resize(); vi.runAllTimers();
  expect(adapter.restore).toHaveBeenCalledExactlyOnceWith(position);
  width = 0; resize(); vi.runAllTimers(); expect(adapter.restore).toHaveBeenCalledTimes(1);
  width = 800; resize(); element.dispatchEvent(new Event('wheel')); vi.runAllTimers();
  expect(adapter.restore).toHaveBeenCalledTimes(1); // User interaction takes priority.
  width = 600; resize(); stop(); vi.runAllTimers();
  expect(adapter.restore).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledOnce();
});

it('cancels a nested adapter restore when the user scrolls after the resize frame', () => {
  vi.useFakeTimers();
  let resize!: () => void;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  const element = document.createElement('div');
  let width = 800;
  Object.defineProperty(element, 'clientWidth', { get: () => width });
  const write = vi.fn();
  let nested = 0;
  const adapter = { capture: () => ({ pageIdx: 1, offset: .4, left: 0 }), navigate: vi.fn(),
    restore: () => { nested = requestAnimationFrame(write); }, cancelRestore: () => cancelAnimationFrame(nested) };
  const stop = observeReadingWidth(element, adapter);
  width = 400; resize();
  vi.advanceTimersToNextTimer();
  element.dispatchEvent(new Event('wheel'));
  vi.runAllTimers();
  expect(write).not.toHaveBeenCalled();
  width = 300; resize(); element.dispatchEvent(new Event('neuink:reading-navigation'));
  vi.runAllTimers(); expect(write).not.toHaveBeenCalled();
  stop(); expect(vi.getTimerCount()).toBe(0);
});
