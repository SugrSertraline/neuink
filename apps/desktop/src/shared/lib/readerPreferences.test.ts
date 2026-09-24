// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { equalReaderPreferences, persistReaderPreferences, readStoredReaderPreferences } from './readerPreferences';

beforeEach(() => window.localStorage.clear());

describe('reader preferences', () => {
  it('defaults to PDF opening with missing or invalid stored preferences', () => {
    expect(readStoredReaderPreferences().openEntryPdfByDefault).toBe(true);
    for (const stored of [{ hoverPreviewEnabled: false }, { openEntryPdfByDefault: 'false' }]) {
      window.localStorage.setItem('neuink.reader.preferences', JSON.stringify(stored));
      expect(readStoredReaderPreferences().openEntryPdfByDefault).toBe(true);
    }
  });
  it('persists either PDF opening choice and detects preference changes', () => {
    const original = readStoredReaderPreferences();
    const disabled = { ...original, openEntryPdfByDefault: false };
    expect(equalReaderPreferences(original, disabled)).toBe(false);
    persistReaderPreferences(disabled);
    expect(readStoredReaderPreferences()).toEqual(disabled);
    persistReaderPreferences(original);
    expect(readStoredReaderPreferences()).toEqual(original);
  });
  it('keeps existing readers in continuous mode and persists an explicit book choice', () => {
    window.localStorage.setItem('neuink.reader.preferences', JSON.stringify({pageDisplayMode:'dual'}));
    expect(readStoredReaderPreferences().pageTurningMode).toBe('scroll');
    persistReaderPreferences({...readStoredReaderPreferences(),pageTurningMode:'book'});
    expect(readStoredReaderPreferences().pageTurningMode).toBe('book');
    expect(readStoredReaderPreferences().pageDisplayMode).toBe('dual');
    window.localStorage.setItem('neuink.reader.preferences', JSON.stringify({pageTurningMode:'unknown'}));
    expect(readStoredReaderPreferences().pageTurningMode).toBe('scroll');
  });
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

  it('defaults pageDisplayMode to single', () => {
    expect(readStoredReaderPreferences().pageDisplayMode).toBe('single');
  });

  it('persists pageDisplayMode', () => {
    const preferences = readStoredReaderPreferences();
    persistReaderPreferences({ ...preferences, pageDisplayMode: 'dual' });

    expect(readStoredReaderPreferences().pageDisplayMode).toBe('dual');
  });

  it('rejects invalid pageDisplayMode values', () => {
    window.localStorage.setItem(
      'neuink.reader.preferences',
      JSON.stringify({ pageDisplayMode: 'triple' })
    );

    expect(readStoredReaderPreferences().pageDisplayMode).toBe('single');
  });

  it('normalizes pageDisplayMode from stored data', () => {
    window.localStorage.setItem(
      'neuink.reader.preferences',
      JSON.stringify({ pageDisplayMode: 'dual' })
    );

    expect(readStoredReaderPreferences().pageDisplayMode).toBe('dual');
  });

  it('persists PDF hover preview font and card sizes', () => {
    const preferences = readStoredReaderPreferences();
    persistReaderPreferences({
      ...preferences,
      pdfHoverPreviewFontSize: 'large',
      pdfHoverPreviewSize: 'compact'
    });

    const stored = readStoredReaderPreferences();
    expect(stored.pdfHoverPreviewFontSize).toBe('large');
    expect(stored.pdfHoverPreviewSize).toBe('compact');
  });

  it('rejects invalid PDF hover preview sizes', () => {
    window.localStorage.setItem(
      'neuink.reader.preferences',
      JSON.stringify({
        pdfHoverPreviewFontSize: 'huge',
        pdfHoverPreviewSize: 'tiny'
      })
    );

    const stored = readStoredReaderPreferences();
    expect(stored.pdfHoverPreviewFontSize).toBe('standard');
    expect(stored.pdfHoverPreviewSize).toBe('standard');
  });

  it('defaults reflow appearance to 16px text on a white background', () => {
    const preferences = readStoredReaderPreferences();

    expect(preferences.reflowFontSize).toBe(16);
    expect(preferences.reflowBackgroundColor).toBe('#ffffff');
  });

  it('persists reflow text size and background color', () => {
    const preferences = readStoredReaderPreferences();
    persistReaderPreferences({
      ...preferences,
      reflowFontSize: 20,
      reflowBackgroundColor: '#fff4dc'
    });

    const stored = readStoredReaderPreferences();
    expect(stored.reflowFontSize).toBe(20);
    expect(stored.reflowBackgroundColor).toBe('#fff4dc');
  });

  it('normalizes invalid reflow appearance values', () => {
    window.localStorage.setItem(
      'neuink.reader.preferences',
      JSON.stringify({ reflowFontSize: 99, reflowBackgroundColor: 'transparent' })
    );

    const stored = readStoredReaderPreferences();
    expect(stored.reflowFontSize).toBe(24);
    expect(stored.reflowBackgroundColor).toBe('#ffffff');
  });

  it('persists component-specific reflow display preferences', () => {
    const preferences = readStoredReaderPreferences();
    persistReaderPreferences({
      ...preferences,
      reflowComponents: {
        ...preferences.reflowComponents,
        chart: { visible: false, size: 'compact' },
        figure: { visible: true, size: 'full' },
        paragraph: { visible: true, size: 'large' },
        diagramVisible: false,
        imageClickToOpen: false
      }
    });

    const stored = readStoredReaderPreferences().reflowComponents;
    expect(stored.chart).toEqual({ visible: false, size: 'compact' });
    expect(stored.figure).toEqual({ visible: true, size: 'full' });
    expect(stored.paragraph).toEqual({ visible: true, size: 'large' });
    expect(stored.diagramVisible).toBe(false);
    expect(stored.imageClickToOpen).toBe(false);
  });

  it('repairs invalid component-specific reflow display preferences', () => {
    window.localStorage.setItem(
      'neuink.reader.preferences',
      JSON.stringify({
        reflowComponents: {
          heading: { visible: 'sometimes', size: 'huge' },
          figure: { visible: false, size: 'tiny' },
          diagramVisible: 'no'
        }
      })
    );

    const stored = readStoredReaderPreferences().reflowComponents;
    expect(stored.heading).toEqual({ visible: true, size: 'standard' });
    expect(stored.figure).toEqual({ visible: false, size: 'standard' });
    expect(stored.diagramVisible).toBe(true);
  });
});
