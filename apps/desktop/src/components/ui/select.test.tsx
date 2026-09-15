// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);
function view(aligned: boolean, onChange = vi.fn()) {
  return <Select defaultValue="word" onValueChange={onChange}>
    <SelectTrigger aria-label="导出格式"><SelectValue /></SelectTrigger>
    <SelectContent viewportAligned={aligned}><SelectItem value="word">Word</SelectItem><SelectItem value="txt">TXT</SelectItem></SelectContent>
  </Select>;
}
describe('Select viewport alignment', () => {
  it('opts in to scaled popper positioning with one viewport scroll owner above dialogs', async () => {
    const onChange = vi.fn();
    render(view(true, onChange));
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = await screen.findByRole('listbox');
    expect(menu.getAttribute('data-align-trigger')).toBe('false');
    expect(menu.className).toContain('overflow-hidden');
    expect(menu.className).not.toContain('overflow-y-auto');
    expect(menu.closest('[data-slot="overlay-viewport"]')?.className).toContain('z-[var(--z-dialog-popover)]');
    const viewport = menu.querySelector('[data-slot="select-viewport"]')!;
    expect(viewport.className).not.toContain('h-(--radix-select-trigger-height)');
    fireEvent.click(screen.getByRole('option', { name: 'TXT' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('txt'));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('keeps the existing item-aligned layout when not opted in', async () => {
    render(view(false));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const menu = await screen.findByRole('listbox');
    expect(menu.getAttribute('data-align-trigger')).toBe('true');
    expect(menu.closest('[data-slot="overlay-viewport"]')).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });
});
