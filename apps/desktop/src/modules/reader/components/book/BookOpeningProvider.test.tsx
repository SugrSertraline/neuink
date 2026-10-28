// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookOpeningProvider, useBookOpening } from './BookOpeningProvider';
vi.mock('@/shared/components/AppearanceProvider', () => ({ useAppearance: () => ({ appearance: 'atelier' }) }));
const pending: Array<{ finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
let reduced = false;
beforeEach(() => {
  pending.length = 0; reduced = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 54, height: 234, left: 50, top: 100 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; }); const cancel = vi.fn(); pending.push({ finish, cancel });
    return { finished, cancel };
  }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });
function Fixture({ commit }: { commit: () => void }) {
  const begin = useBookOpening();
  return <button data-book-index="0" onClick={event => begin({ id: 'flow-test', title: 'Research Title', tags: ['Research'] }, event.currentTarget, commit)}>取书</button>;
}
it('opens the tab only after pickup and the live cover swing, once', async () => {
  const commit = vi.fn(); render(<BookOpeningProvider><Fixture commit={commit} /></BookOpeningProvider>);
  const source = screen.getByText('取书'); fireEvent.click(source); fireEvent.click(source);
  expect(pending.length).toBe(2); expect(commit).not.toHaveBeenCalled();
  expect(document.querySelector('.book-opening-mover img, .book-opening-mover canvas')).toBeNull();
  expect(document.querySelector('.book-opening-mover .library-book-title')?.textContent).toBe('Research Title');
  await act(async () => { pending[0].finish(); pending[1].finish(); });
  expect(commit).not.toHaveBeenCalled();
  await act(async () => pending[2].finish());
  expect(commit).not.toHaveBeenCalled();
  await act(async () => { pending[3].finish(); pending[4].finish(); });
  expect(commit).toHaveBeenCalledOnce();
  await act(async () => pending[5].finish());
  expect(screen.queryByRole('dialog')).toBeNull(); expect(source.style.visibility).toBe('');
});
it('cancels pending pickup without opening a tab and restores the source', async () => {
  const commit = vi.fn(); render(<BookOpeningProvider><Fixture commit={commit} /></BookOpeningProvider>);
  const source = screen.getByText('取书'); fireEvent.click(source); fireEvent.click(screen.getByText('取消'));
  await act(async () => { pending[0].finish(); pending[1].finish(); });
  expect(commit).not.toHaveBeenCalled(); expect(source.style.visibility).toBe('');
  expect(pending.every(value => value.cancel.mock.calls.length === 1)).toBe(true);
});
it('opens immediately without a motion overlay when reduced motion is requested', () => {
  reduced = true; const commit = vi.fn(); render(<BookOpeningProvider><Fixture commit={commit} /></BookOpeningProvider>);
  fireEvent.click(screen.getByText('取书')); expect(commit).toHaveBeenCalledOnce(); expect(pending.length).toBe(0);
});
