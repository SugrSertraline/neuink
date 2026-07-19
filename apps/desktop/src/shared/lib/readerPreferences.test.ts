// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { persistReaderPreferences, readStoredReaderPreferences } from './readerPreferences';

beforeEach(() => window.localStorage.clear());

describe('reader preferences', () => {
  it('keeps automatic selection translation disabled for existing users', () => {
    window.localStorage.setItem(
      'neuink.reader.preferences',
      JSON.stringify({ hoverPreviewEnabled: false })
    );

    expect(readStoredReaderPreferences().autoTranslateTextSelection).toBe(false);
  });

  it('persists automatic selection translation', () => {
    const preferences = readStoredReaderPreferences();
    persistReaderPreferences({ ...preferences, autoTranslateTextSelection: true });

    expect(readStoredReaderPreferences().autoTranslateTextSelection).toBe(true);
  });
});
