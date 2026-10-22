// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePdfReaderZoom } from './usePdfReaderZoom';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const options = { entryId: 'a', viewportWidth: 600, pageDisplayMode: 'single' as const, onInteractionStart: () => {} };
it('fits a new paper to width and follows container resizes without persisting a false 30% preference', () => {
  const view = renderHook((props) => usePdfReaderZoom(props), { initialProps: options });
  expect(view.result.current.zoom).toBe(1);
  expect(view.result.current.pageWidth).toBe(504);
  view.rerender({ ...options, viewportWidth: 400 });
  expect(view.result.current.pageWidth).toBe(304);
  expect(localStorage.getItem('neuink.reader.pdfZoom.a')).toBeNull();
});
it('preserves user zoom per paper without overwriting the next paper on switch', () => {
  localStorage.setItem('neuink.reader.pdfZoom.b', '1.3');
  const view = renderHook((props) => usePdfReaderZoom(props), { initialProps: options });
  act(() => view.result.current.updateZoom(() => 1.2));
  view.rerender({ ...options, entryId: 'b' });
  expect(view.result.current.zoom).toBe(1.3);
  expect(localStorage.getItem('neuink.reader.pdfZoom.a')).toBe('1.2');
  expect(localStorage.getItem('neuink.reader.pdfZoom.b')).toBe('1.3');
});
it('uses valid legacy preferences and survives inaccessible storage', () => {
  localStorage.setItem('neuink.reader.pdfZoom', '0.8');
  const legacy = renderHook(() => usePdfReaderZoom(options));
  expect(legacy.result.current.zoom).toBe(0.8);
  legacy.unmount();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  const view = renderHook(() => usePdfReaderZoom(options));
  expect(view.result.current.zoom).toBe(1);
});
it('keeps buttons at one-percent steps, rounds values and clamps the expanded range', () => {
  const view = renderHook(() => usePdfReaderZoom(options));
  act(() => view.result.current.updateZoom(value => value + .01));
  expect(view.result.current.zoom).toBe(1.01);
  act(() => view.result.current.updateZoom(value => value - .01));
  expect(view.result.current.zoom).toBe(1);
  act(() => view.result.current.updateZoom(() => 1.234567));
  expect(view.result.current.zoom).toBe(1.23);
  act(() => view.result.current.updateZoom(() => 10));
  expect(view.result.current.zoom).toBe(3);
  act(() => view.result.current.updateZoom(() => 0));
  expect(view.result.current.zoom).toBe(0.1);
});

const wheel = (deltaY: number, timeStamp: number) => ({ deltaY, deltaMode: 0, timeStamp, viewportHeight: 600 });
it('accelerates fast wheel input and batches geometry commits into one frame', () => {
  const interaction = vi.fn();
  const view = renderHook(() => usePdfReaderZoom({ ...options, onInteractionStart: interaction }));
  act(() => view.result.current.handleCtrlWheelZoom(wheel(-100, 1000)));
  expect(view.result.current.zoom).toBe(1);
  act(() => vi.advanceTimersByTime(20));
  expect(view.result.current.zoom).toBe(1.05);
  act(() => {
    view.result.current.handleCtrlWheelZoom(wheel(-100, 1040));
    view.result.current.handleCtrlWheelZoom(wheel(-100, 1050));
  });
  expect(interaction).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(20));
  expect(view.result.current.zoom).toBe(1.32);
  expect(interaction).toHaveBeenCalledTimes(2);
  act(() => view.result.current.handleCtrlWheelZoom(wheel(100, 1060)));
  act(() => vi.advanceTimersByTime(20));
  expect(view.result.current.zoom).toBe(1.27); // Reversing does not inherit acceleration.
});

it('accumulates small trackpad deltas without applying a full step to each event', () => {
  const view = renderHook(() => usePdfReaderZoom(options));
  for (let i = 0; i < 10; i++) {
    act(() => view.result.current.handleCtrlWheelZoom(wheel(-1, 1000 + i * 80)));
    act(() => vi.advanceTimersByTime(20));
  }
  expect(view.result.current.zoom).toBe(1.01);
});

it('does not replay queued zoom after reset, document switch or unmount', () => {
  const view = renderHook(props => usePdfReaderZoom(props), { initialProps: options });
  act(() => view.result.current.handleCtrlWheelZoom(wheel(-100, 1000)));
  act(() => view.result.current.updateZoom(() => 1));
  act(() => vi.advanceTimersByTime(500));
  expect(view.result.current.zoom).toBe(1);
  act(() => view.result.current.handleCtrlWheelZoom(wheel(-100, 2000)));
  view.rerender({ ...options, entryId: 'b' });
  act(() => vi.advanceTimersByTime(500));
  expect(view.result.current.zoom).toBe(1);
  expect(localStorage.getItem('neuink.reader.pdfZoom.b')).toBeNull();
  act(() => view.result.current.handleCtrlWheelZoom(wheel(-100, 3000)));
  view.unmount();
  act(() => vi.advanceTimersByTime(500));
  expect(localStorage.getItem('neuink.reader.pdfZoom.b')).toBeNull();
});
