// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readingViewStorageKey, readReadingViewState, saveReadingViewState } from './readingViewStorage';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('merges position and mode updates without storing navigation history or invalid geometry', () => {
  const key = readingViewStorageKey('root', 'pdf:paper')!;
  saveReadingViewState(key, { mode: 'replace' });
  saveReadingViewState(key, { positions: { doc: { pageIdx: 3, offset: .34, left: 15, segmentUid: 'item', segmentOffset: .1, zoom: 1.2 } } });
  const saved = readReadingViewState(key);
  expect(saved.mode).toBe('replace');
  expect(saved.positions.doc.pageIdx).toBe(3);
  expect(readReadingViewState(readingViewStorageKey('other', 'pdf:paper')).positions).toEqual({});
  localStorage.setItem(key, JSON.stringify({ version: 1, mode: 'unknown', positions: {
    bad: { pageIdx: -1, offset: 0, left: 0 }, overflow: { pageIdx: 2, offset: 100000, left: 0 },
    valid: { pageIdx: 2, offset: -.02, left: 0, zoom: 999, markdown: 'not a preference' } } }));
  expect(readReadingViewState(key)).toEqual({ mode: 'original', positions: { valid: { pageIdx: 2, offset: -.02, left: 0 } } });
});
it('bounds saved anchors and treats corrupt or inaccessible storage as a fresh view', () => {
  localStorage.setItem('view', JSON.stringify({ version: 1, positions: Object.fromEntries(Array.from({ length: 50 }, (_, n) => [String(n), { pageIdx: n, offset: 0, left: 0 }])) }));
  expect(Object.keys(readReadingViewState('view').positions)).toHaveLength(8);
  localStorage.setItem('view', '{');
  expect(readReadingViewState('view')).toEqual({ mode: 'original', positions: {} });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  expect(readReadingViewState('view').positions).toEqual({});
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(saveReadingViewState('view', { mode: 'replace' })).toBe(false);
});
