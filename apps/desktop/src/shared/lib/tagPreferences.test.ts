// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TAG_PREFERENCES, getEntryTagLabel, getVisibleEntryTags, normalizeTagPreferences, readStoredTagPreferences, TAG_PREFERENCES_STORAGE_KEY } from './tagPreferences';

beforeEach(() => window.localStorage.clear());

describe('entry tag display projection', () => {
  it('hides assigned ancestors while preserving each independent branch', () => {
    const tags = Object.freeze(['研究', '研究/软件工程', '研究/软件工程/代码生成', '状态/待读', '方法', '方法/实验']);
    expect(getVisibleEntryTags(tags, true)).toEqual(['研究/软件工程/代码生成', '状态/待读', '方法/实验']);
    expect(tags).toHaveLength(6);
  });
  it('keeps a parent when this entry has no assigned descendants', () => {
    expect(getVisibleEntryTags(['研究/软件工程', '项目/CHI'], true)).toEqual(['研究/软件工程', '项目/CHI']);
  });
  it('does not mistake name prefixes or identically named leaves for ancestry', () => {
    expect(getVisibleEntryTags(['研究/AI', '研究/AI工具/编码', '项目/编码'], true)).toEqual(['研究/AI', '研究/AI工具/编码', '项目/编码']);
  });
  it('retains sibling leaves, stable ordering and all real tags when disabled', () => {
    const tags = ['A/B/C', 'A', 'A/B', 'A/B/D', 'A'];
    expect(getVisibleEntryTags(tags, true)).toEqual(['A/B/C', 'A/B/D']);
    expect(getVisibleEntryTags(tags, false)).toEqual(['A/B/C', 'A', 'A/B', 'A/B/D']);
    expect(getVisibleEntryTags([], true)).toEqual([]);
  });
  it('qualifies duplicate leaf names with their full paths', () => {
    expect(getEntryTagLabel('研究/编码', ['研究/编码', '项目/编码'])).toBe('研究/编码');
    expect(getEntryTagLabel('研究/编码', ['研究/编码', '项目/分析'])).toBe('编码');
  });
});

describe('tag display preference persistence', () => {
  it('defaults to directory navigation with the most specific labels', () => {
    expect(readStoredTagPreferences()).toEqual(DEFAULT_TAG_PREFERENCES);
  });
  it('recovers missing, invalid and malformed stored fields', () => {
    for (const raw of ['null', '{', '[]', '{"navigationMode":"invalid","showCounts":"false"}']) {
      window.localStorage.setItem(TAG_PREFERENCES_STORAGE_KEY, raw);
      expect(readStoredTagPreferences()).toEqual(DEFAULT_TAG_PREFERENCES);
    }
  });
  it('preserves explicit false values and valid personal choices', () => {
    const stored = { navigationMode: 'tree', density: 'comfortable', showCounts: false, onlyMostSpecificTags: false };
    expect(normalizeTagPreferences(stored)).toEqual(stored);
  });
});
