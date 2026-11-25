// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ReflowLanguageControls } from './ReflowLanguageControls';

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

it('separates source-language layout from Chinese translation visibility', () => {
  const original = vi.fn(), translation = vi.fn();
  render(<TooltipProvider><ReflowLanguageControls original="original" translation={false}
    onOriginalChange={original} onTranslationChange={translation} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('switch', { name: '显示中文译文' }));
  expect(translation).toHaveBeenCalledWith(true);
  expect(original).not.toHaveBeenCalled();
  const trigger = screen.getByRole('combobox', { name: '源语言显示' });
  expect(trigger.textContent).toBe('整段');
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getAllByRole('option').map(item => item.textContent)).toEqual(['整段', '逐句', '隐藏']);
  fireEvent.click(screen.getByRole('option', { name: '逐句' }));
  expect(original).toHaveBeenCalledWith('sentences');
  expect(translation).toHaveBeenCalledTimes(1);
});

it('keeps hidden source content distinct from untranslated content', () => {
  const change = vi.fn();
  render(<TooltipProvider><ReflowLanguageControls original="hidden" translation
    onOriginalChange={change} onTranslationChange={vi.fn()} /></TooltipProvider>);
  expect(screen.getByRole('combobox', { name: '源语言显示' }).textContent).toBe('隐藏');
  expect(screen.getByRole('switch', { name: '显示中文译文' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: '整段' }));
  expect(change).toHaveBeenCalledWith('original');
});
