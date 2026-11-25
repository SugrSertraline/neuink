import { expect, it } from 'vitest';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { effectiveFoldOriginal, foldLevelAfterOriginalChange, initialFoldLevel } from './foldDisplay';

it('defaults to original detail while respecting saved sentence layout even with source hidden', () => {
  const preferences = readStoredReaderPreferences();
  expect(initialFoldLevel(preferences)).toBe('full');
  expect(initialFoldLevel({ ...preferences, reflowTranslationMode: 'sentences' })).toBe('off');
  const hidden = { ...preferences, reflowComponents: { ...preferences.reflowComponents,
    content: { paragraph: { parsed: false, translation: true, translationView: 'sentences' as const } } } };
  expect(initialFoldLevel(hidden)).toBe('off');
  expect(hidden.reflowComponents.content.paragraph.translationView).toBe('sentences');
});

it('pauses sentence display during folding and restores the saved preference when off', () => {
  expect(effectiveFoldOriginal('key', 'sentences')).toBe('original');
  expect(effectiveFoldOriginal('off', 'sentences')).toBe('sentences');
  expect(effectiveFoldOriginal('key', 'hidden')).toBe('hidden');
  expect(foldLevelAfterOriginalChange('key', 'sentences')).toBe('off');
  expect(foldLevelAfterOriginalChange('key', 'original')).toBe('key');
  expect(foldLevelAfterOriginalChange('off', 'original')).toBe('full');
  expect(foldLevelAfterOriginalChange('off', 'hidden')).toBe('full');
  expect(effectiveFoldOriginal('full', 'sentences')).toBe('original');
});
