// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MealSlotWidget } from './MealSlotWidget';
let finish: () => void, reduced = false;
const cancel = vi.fn();
beforeEach(() => {
  reduced = false; cancel.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => ({
    finished: new Promise<void>(resolve => { finish = resolve; }), cancel,
  })) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });
const props = () => ({ active: true, date: '2026-10-27', meals: ['面条', '米饭', '饺子'], selected: '面条', onPick: vi.fn(), onSettings: vi.fn() });
it('commits once after the reel stops and prevents overlapping spins', async () => {
  const p = props(), ui = render(<MealSlotWidget {...p} />), button = ui.getByRole('button', { name: '转一转，决定今天吃什么' });
  fireEvent.click(button); fireEvent.click(button);
  expect(p.onPick).not.toHaveBeenCalled(); expect(HTMLElement.prototype.animate).toHaveBeenCalledOnce();
  expect(ui.getByRole('status').textContent).toContain('正在挑选');
  await act(async () => finish());
  expect(p.onPick).toHaveBeenCalledOnce(); expect(['米饭', '饺子']).toContain(p.onPick.mock.calls[0][0]);
});
it('cancels the animation when leaving the sidebar and ignores late completion', async () => {
  const p = props(), ui = render(<MealSlotWidget {...p} />);
  fireEvent.click(ui.getByRole('button', { name: '转一转，决定今天吃什么' }));
  ui.rerender(<MealSlotWidget {...p} active={false} />);
  await act(async () => finish()); expect(cancel).toHaveBeenCalled(); expect(p.onPick).not.toHaveBeenCalled();
});
it('shows an immediate result for reduced motion and allows an empty custom menu', () => {
  reduced = true; const p = props(), ui = render(<MealSlotWidget {...p} />);
  fireEvent.click(ui.getByRole('button', { name: '转一转，决定今天吃什么' }));
  expect(p.onPick).toHaveBeenCalledOnce(); expect(HTMLElement.prototype.animate).not.toHaveBeenCalled();
  ui.rerender(<MealSlotWidget {...p} meals={[]} />);
  expect(ui.queryByRole('button', { name: '转一转，决定今天吃什么' })).toBeNull();
  fireEvent.click(ui.getByText('编辑菜单')); expect(p.onSettings).toHaveBeenCalledOnce();
});
it('cancels an in-flight choice when switching category without remounting its controls', async () => {
  const p = props(), ui = render(<MealSlotWidget {...p} controls={<button>分类</button>} />);
  const control = ui.getByRole('button', { name: '分类' });
  fireEvent.click(ui.getByRole('button', { name: '转一转，决定今天吃什么' }));
  ui.rerender(<MealSlotWidget {...p} scope="drink" kind="drink" meals={['雪碧', '可乐']} controls={<button>分类</button>} />);
  await act(async () => finish());
  expect(p.onPick).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalled();
  expect(ui.getByRole('button', { name: '分类' })).toBe(control);
  expect(ui.getByRole('button', { name: '转一转，决定今天喝什么' }).textContent).toContain('帮我选一杯');
});
