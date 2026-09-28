// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppearanceProvider, useAppearance } from '@/shared/components/AppearanceProvider';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { PdfReadingModeControl } from './PdfReadingModeControl';
import { effectivePdfBookMode } from './pdfReadingMode';

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('PDF reading mode appearance gate', () => {
  it('uses continuous rendering outside the atelier without clearing the saved book preference', () => {
    const preferences = { ...readStoredReaderPreferences(), pageTurningMode: 'book' as const };
    expect(effectivePdfBookMode('standard', preferences)).toBe(false);
    expect(effectivePdfBookMode('liquid-glass', preferences)).toBe(false);
    expect(effectivePdfBookMode('atelier', preferences)).toBe(true);
    expect(preferences.pageTurningMode).toBe('book');
  });

  it('disables the mode switch outside the atelier and restores it when returning', () => {
    const onChange = vi.fn();
    const preferences = { ...readStoredReaderPreferences(), pageTurningMode: 'book' as const };
    function Harness() {
      const { setAppearance } = useAppearance();
      return <>
        <button onClick={() => setAppearance('atelier')}>拟物主题</button>
        <button onClick={() => setAppearance('liquid-glass')}>玻璃主题</button>
        <PdfReadingModeControl preferences={preferences} onChange={onChange} />
      </>;
    }
    render(<AppearanceProvider><Harness /></AppearanceProvider>);

    let mode = screen.getByRole('button', { name: '连续阅读；书页模式仅拟物主题可用' });
    expect(mode).toHaveProperty('disabled', true);
    expect(mode.textContent).toContain('连续');

    fireEvent.click(screen.getByRole('button', { name: '拟物主题' }));
    mode = screen.getByRole('button', { name: '书页阅读' });
    expect(mode).toHaveProperty('disabled', false);
    expect(mode.textContent).toContain('书页');
    fireEvent.click(mode);
    expect(onChange).toHaveBeenCalledWith({ ...preferences, pageTurningMode: 'scroll' });

    fireEvent.click(screen.getByRole('button', { name: '玻璃主题' }));
    mode = screen.getByRole('button', { name: '连续阅读；书页模式仅拟物主题可用' });
    expect(mode).toHaveProperty('disabled', true);
    fireEvent.click(mode);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
