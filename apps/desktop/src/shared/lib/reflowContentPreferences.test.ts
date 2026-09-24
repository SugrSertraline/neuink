/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredReaderPreferences, persistReaderPreferences } from './readerPreferences';
import { resolveReflowContent } from './reflowContentPreferences';

beforeEach(() => localStorage.clear());
describe('reflow content preferences', () => {
  it('keeps legacy sizes while defaulting images, tables and charts to the original', () => {
    localStorage.setItem('neuink.reader.preferences', JSON.stringify({ reflowComponents: { table: { visible: true, size: 'large' } } }));
    const preferences = readStoredReaderPreferences();
    expect(preferences.reflowComponents.table.size).toBe('large');
    for (const key of ['figure', 'table', 'chart'] as const) expect(resolveReflowContent(key, 'source', preferences.reflowComponents.content?.[key])).toMatchObject({ image: true, translation: false, parsed: false });
  });
  it('persists type-specific layers and sentence layout, discarding malformed fields', () => {
    localStorage.setItem('neuink.reader.preferences', JSON.stringify({ reflowComponents: { content: {
      figure: { original: false, parsed: true, translation: 'true' }, paragraph: { translation: true, translationView: 'sentences' }, alien: { parsed: true },
    } } }));
    const preferences = readStoredReaderPreferences();
    expect(preferences.reflowComponents.content).toEqual({ figure: { original: false, parsed: true }, paragraph: { translation: true, translationView: 'sentences' } });
    persistReaderPreferences(preferences);
    expect(readStoredReaderPreferences()).toEqual(preferences);
  });
  it('overrides only explicitly selected segment fields while inheriting subsequent type changes', () => {
    const result = resolveReflowContent('figure', 'source', { original: false, translation: true, parsed: true }, { parsed: false });
    expect(result).toMatchObject({ image: false, translation: true, parsed: false });
  });
  it('migrates legacy original flags by type without conflating images with parsed text', () => {
    expect(resolveReflowContent('paragraph', 'source', { original: false })).toMatchObject({ image: false, parsed: false });
    expect(resolveReflowContent('figure', 'source', { original: true }, { image: false, parsed: true })).toMatchObject({ image: false, parsed: true });
    expect(resolveReflowContent('paragraph', 'source', { image: true })).toMatchObject({ image: true, parsed: true });
  });
});
