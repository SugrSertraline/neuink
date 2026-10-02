import { describe, expect, it } from 'vitest';
import { pdfTranslationDisplay } from './usePdfTranslationController';

describe('PDF translation display', () => {
  it('keeps hover preview available in both original and translated page modes', () => {
    expect(pdfTranslationDisplay('original')).toEqual({ translationMode: 'hover', visible: true });
    expect(pdfTranslationDisplay('replace')).toEqual({ translationMode: 'replace', visible: true });
  });
});
