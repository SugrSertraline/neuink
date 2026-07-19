import { describe, expect, it } from 'vitest';

import { adjacentUiScale, normalizeUiScale } from './uiScale';

describe('uiScale', () => {
  it('normalizes persisted values to a supported scale', () => {
    expect(normalizeUiScale('0.9')).toBe(0.9);
    expect(normalizeUiScale(0.84)).toBe(0.8);
    expect(normalizeUiScale('invalid')).toBe(1);
  });

  it('steps through scale options without exceeding the limits', () => {
    expect(adjacentUiScale(1, -1)).toBe(0.9);
    expect(adjacentUiScale(1, 1)).toBe(1.1);
    expect(adjacentUiScale(0.7, -1)).toBe(0.7);
    expect(adjacentUiScale(1.5, 1)).toBe(1.5);
  });
});
