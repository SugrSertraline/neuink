// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePdfReaderZoom } from './usePdfReaderZoom';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
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
