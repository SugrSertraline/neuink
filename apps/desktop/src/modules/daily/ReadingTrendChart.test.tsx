// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
import { ReadingTrendChart } from './ReadingTrendChart';
import { READING_CHART_STORAGE_KEY } from './readingTrend';
const materialAppearance = vi.hoisted(() => ({ value: 'standard' }));
vi.mock('@/shared/components/AppearanceProvider', () => ({ useAppearance: () => ({ appearance: materialAppearance.value }) }));

beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); materialAppearance.value = 'standard'; window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const entries = [{ id: 'a' }] as LibraryEntry[];
const states: Record<string, EntryReadingState> = { a: {
  entry_id: 'a', version: 1, document_hash: null, mode: 'pdf', current_page_idx: 0, page_count: 1, visited_pages: [0],
  total_active_ms: 2_700_000, session_count: 1, last_read_at: null,
  reading_sessions: [1, 4].map((minutes, index) => ({ id: `session-${index}`, local_date: '2026-10-23', started_at: `2026-10-23T1${index}:00:00Z`, ended_at: `2026-10-23T1${index}:0${minutes}:00Z`, active_ms: minutes * 60_000 })),
  daily_active_ms: { '2026-10-19': 600_000, '2026-10-20': 1_800_000, '2026-10-23': 300_000 },
} };
const props = () => ({ entries, states, date: '2026-10-23', onSelectDate: vi.fn() });
const chart = (name: string) => within(screen.getByRole('region', { name }));
const points = (name: string) => chart(name).getAllByRole('button');
const lastPoint = (name: string) => { const buttons = points(name); return buttons[buttons.length - 1]; };

it('preserves measured bar geometry and date navigation when switching material, without raising zero-value days', () => {
  const values = props(); const ui = render(<ReadingTrendChart {...values} />);
  const primary = screen.getByRole('region', { name: '柱状图' });
  const measure = (node: Element) => ['x', 'y', 'width', 'height'].map(name => node.getAttribute(name));
  const ordinary = Array.from(primary.querySelectorAll('svg rect')).filter(node => Number(node.getAttribute('height')) > 0).map(measure);
  const controls = points('柱状图');
  materialAppearance.value = 'atelier'; ui.rerender(<ReadingTrendChart {...values} />);
  expect(Array.from(primary.querySelectorAll('[data-chart-face]')).map(measure)).toEqual(ordinary);
  expect(primary.querySelectorAll('[data-chart-prism]')).toHaveLength(3);
  expect(points('柱状图')).toEqual(controls);
  fireEvent.click(chart('柱状图').getByRole('button', { name: /2026-10-20/ }));
  expect(values.onSelectDate).toHaveBeenCalledWith('2026-10-20');
  const definitions = Array.from(ui.container.querySelectorAll('svg defs [id]')).map(node => node.id);
  expect(new Set(definitions).size).toBe(definitions.length);
  materialAppearance.value = 'standard'; ui.rerender(<ReadingTrendChart {...values} />);
  expect(primary.querySelector('[data-chart-prism]')).toBeNull();
  expect(Array.from(primary.querySelectorAll('svg rect')).filter(node => Number(node.getAttribute('height')) > 0).map(measure)).toEqual(ordinary);
});

it('keeps independent wheel ranges, keyboard inspection and session values in the material theme', () => {
  materialAppearance.value = 'atelier';
  const values = props(); render(<ReadingTrendChart {...values} />);
  const previews = ['折线图', '热力图', '日 K 线'].map(name => screen.getByRole('region', { name }));
  const before = previews.map(node => node.innerHTML);
  fireEvent.wheel(lastPoint('柱状图'), { deltaY: -120 });
  expect(points('柱状图')).toHaveLength(22);
  expect(previews.map(node => node.innerHTML)).toEqual(before);
  fireEvent.click(screen.getByRole('button', { name: '放大查看日 K 线' }));
  act(() => lastPoint('日 K 线').focus());
  expect(screen.getByRole('tooltip').textContent).toContain('开盘 · 首段1 分');
  expect(screen.getByRole('tooltip').textContent).toContain('收盘 · 末段4 分');
  fireEvent.keyDown(lastPoint('日 K 线'), { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '放大查看热力图' }));
  expect(points('热力图')).toHaveLength(28);
  const zero = chart('热力图').getByRole('button', { name: /2026-10-22/ });
  expect(zero.hasAttribute('data-empty')).toBe(true);
  act(() => zero.focus());
  fireEvent.keyDown(zero, { key: 'ArrowLeft' });
  expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-15');
});

it('shows one interactive primary chart and three read-only preview buttons, without instructions or selectors', () => {
  window.localStorage.setItem(READING_CHART_STORAGE_KEY, JSON.stringify({ mode: 'candle', weeks: 1 }));
  render(<ReadingTrendChart {...props()} />);
  expect(points('柱状图')).toHaveLength(28);
  for (const name of ['折线图', '热力图', '日 K 线']) {
    expect(points(name)).toHaveLength(1);
    expect(chart(name).getByRole('button', { name: `放大查看${name}` })).toBeTruthy();
  }
  expect(screen.queryByText(/图内滚轮/)).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByLabelText('阅读图表范围').textContent).toContain('近 28 天');
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.queryByLabelText('日期阅读详情')).toBeNull();
});

it('zooms only the primary graph without changing preview plots, selected day or page scrolling', () => {
  const values = props(); const ui = render(<ReadingTrendChart {...values} />);
  const previews = ['折线图', '热力图', '日 K 线'].map(name => screen.getByRole('region', { name }));
  const before = previews.map(preview => preview.innerHTML);
  const point = lastPoint('柱状图');
  const wheel = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  fireEvent(point, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(points('柱状图')).toHaveLength(22);
  expect(previews.map(preview => preview.innerHTML)).toEqual(before);
  const previewWheel = new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  fireEvent(screen.getByRole('button', { name: '放大查看折线图' }), previewWheel);
  expect(previewWheel.defaultPrevented).toBe(false); expect(points('柱状图')).toHaveLength(22);
  expect(values.onSelectDate).not.toHaveBeenCalled();
  expect(screen.getByLabelText('阅读图表范围').textContent).toContain('10/23');
  const outside = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  fireEvent(screen.getByText('阅读趋势'), outside); expect(outside.defaultPrevented).toBe(false);
  fireEvent(point, new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
  expect(points('柱状图')).toHaveLength(22);
  ui.unmount(); render(<ReadingTrendChart {...values} />); expect(points('柱状图')).toHaveLength(22);
});

it('retains four independent ranges through swaps, keyboard reset and remount', () => {
  const values = props(); const ui = render(<ReadingTrendChart {...values} />);
  fireEvent.wheel(lastPoint('柱状图'), { deltaY: -120 }); // 22 days
  for (const [name, delta, expected] of [['折线图', 120, 34], ['热力图', -80, 24], ['日 K 线', 80, 32]] as const) {
    fireEvent.click(screen.getByRole('button', { name: `放大查看${name}` }));
    expect(points(name)).toHaveLength(28);
    fireEvent.wheel(lastPoint(name), { deltaY: delta });
    expect(points(name)).toHaveLength(expected);
  }
  fireEvent.click(screen.getByRole('button', { name: '放大查看折线图' }));
  expect(points('折线图')).toHaveLength(34);
  fireEvent.keyDown(lastPoint('折线图'), { key: '0' });
  expect(points('折线图')).toHaveLength(28);
  ui.unmount(); render(<ReadingTrendChart {...values} />);
  expect(points('柱状图')).toHaveLength(22);
  for (const [name, expected] of [['折线图', 28], ['热力图', 24], ['日 K 线', 32]] as const) {
    fireEvent.click(screen.getByRole('button', { name: `放大查看${name}` }));
    expect(points(name)).toHaveLength(expected);
    expect(screen.getByLabelText('阅读图表范围').textContent).toContain(`近 ${expected} 天`);
  }
});

it('does not carry a partial wheel gesture into the next primary chart', () => {
  render(<ReadingTrendChart {...props()} />);
  fireEvent.wheel(lastPoint('柱状图'), { deltaY: -30 });
  fireEvent.click(screen.getByRole('button', { name: '放大查看折线图' }));
  fireEvent.wheel(lastPoint('折线图'), { deltaY: -20 });
  expect(points('折线图')).toHaveLength(28);
  fireEvent.wheel(lastPoint('折线图'), { deltaY: -20 });
  expect(points('折线图')).toHaveLength(26);
  fireEvent.click(screen.getByRole('button', { name: '放大查看柱状图' }));
  expect(points('柱状图')).toHaveLength(28);
});

it('bounds wheel zoom and supports keyboard range adjustment and reset', () => {
  render(<ReadingTrendChart {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: '放大查看折线图' }));
  for (let i = 0; i < 10; i++) fireEvent.wheel(lastPoint('折线图'), { deltaY: -600 });
  expect(points('折线图')).toHaveLength(7);
  for (let i = 0; i < 10; i++) fireEvent.wheel(lastPoint('折线图'), { deltaY: 600 });
  expect(points('折线图')).toHaveLength(90);
  fireEvent.keyDown(lastPoint('折线图'), { key: '0' }); expect(points('折线图')).toHaveLength(28);
  fireEvent.keyDown(lastPoint('折线图'), { key: '+' }); expect(points('折线图')).toHaveLength(21);
  fireEvent.keyDown(lastPoint('折线图'), { key: '-' }); expect(points('折线图')).toHaveLength(28);
});

it('swaps previews into the primary slot, preserving date inspection and keyboard focus', () => {
  const values = props(); render(<ReadingTrendChart {...values} />);
  expect(points('柱状图').filter(button => button.tabIndex === 0)).toHaveLength(1);
  const last = lastPoint('柱状图');
  act(() => last.focus()); fireEvent.keyDown(last, { key: 'ArrowLeft' });
  expect(screen.getByRole('tooltip').textContent).toContain('2026-10-22');
  expect(values.onSelectDate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '放大查看热力图' }));
  expect(points('柱状图')).toHaveLength(1); expect(points('热力图')).toHaveLength(28);
  expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-22');
  const cell = chart('热力图').getByRole('button', { name: /2026-10-22/ });
  act(() => cell.focus()); fireEvent.keyDown(cell, { key: 'ArrowLeft' });
  expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-15');
  fireEvent.click(document.activeElement!); expect(values.onSelectDate).toHaveBeenCalledWith('2026-10-15');
});

it('retains session OHLC and distinguishes legacy totals and an empty range', () => {
  const values = props(); const ui = render(<ReadingTrendChart {...values} />);
  fireEvent.click(screen.getByRole('button', { name: '放大查看日 K 线' }));
  act(() => lastPoint('日 K 线').focus());
  const detail = screen.getByRole('tooltip');
  expect(detail.textContent).toContain('5 分钟');
  for (const [label, value] of [['开盘 · 首段', '1 分'], ['收盘 · 末段', '4 分'], ['最高 · 最长', '4 分'], ['最低 · 最短', '1 分']]) expect(within(detail).getByText(label).parentElement?.textContent).toContain(value);
  act(() => chart('日 K 线').getByRole('button', { name: /2026-10-20/ }).focus());
  expect(detail.textContent).toContain('分段记录不完整'); expect(detail.textContent).toContain('30 分钟');
  ui.rerender(<ReadingTrendChart {...values} states={{}} />);
  expect(screen.getByText('这个时间范围内还没有阅读记录。')).toBeTruthy();
});

it('keeps hover and keyboard hints inside the plot and dismisses them without changing the selected date', () => {
  const values = props(); render(<ReadingTrendChart {...values} />);
  const point = chart('柱状图').getByRole('button', { name: /2026-10-20/ });
  const plot = point.closest('[data-reading-zoom]')!;
  fireEvent.mouseEnter(point);
  expect(within(plot.closest('[data-reading-chart-grid]') as HTMLElement).getByRole('tooltip').textContent).toContain('30 分钟');
  expect(point.hasAttribute('title')).toBe(false);
  fireEvent.mouseLeave(plot); expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => point.focus()); expect(screen.getByRole('tooltip')).toBeTruthy();
  fireEvent.keyDown(point, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.keyDown(point, { key: 'ArrowRight' }); expect(screen.getByRole('tooltip').textContent).toContain('2026-10-21');
  act(() => screen.getByRole('button', { name: '放大查看折线图' }).focus());
  expect(chart('柱状图').queryByRole('tooltip')).toBeNull();
  expect(screen.getByRole('tooltip').textContent).toContain('每日时长变化');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull(); expect(values.onSelectDate).not.toHaveBeenCalled();
});

it('follows the pointer in chart coordinates at UI zoom, flips near edges, and dismisses on scrolling', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tooltip' ? 80 : 0;
  });
  render(<ReadingTrendChart {...props()} />);
  const point = lastPoint('柱状图');
  const grid = point.closest('[data-reading-chart-grid]') as HTMLElement;
  Object.defineProperties(grid, { offsetWidth: { value: 800 }, clientWidth: { value: 800 }, clientHeight: { value: 360 } });
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 1000, 450));
  fireEvent.mouseEnter(point, { clientX: 350, clientY: 230 });
  const tooltip = screen.getByRole('tooltip');
  expect(tooltip.style.left).toBe('208px'); expect(tooltip.style.top).toBe('128px');
  const plotBefore = point.closest('[data-reading-zoom]')!.innerHTML;
  fireEvent.mouseMove(point, { clientX: 450, clientY: 280 });
  act(() => frames.splice(0).forEach(callback => callback(0)));
  expect(tooltip.style.left).toBe('288px'); expect(tooltip.style.top).toBe('168px');
  expect(point.closest('[data-reading-zoom]')!.innerHTML).toBe(plotBefore);
  fireEvent.mouseMove(point, { clientX: 1080, clientY: 510 });
  act(() => frames.splice(0).forEach(callback => callback(0)));
  expect(tooltip.style.left).toBe('560px'); expect(tooltip.style.top).toBe('256px');
  expect(tooltip.classList.contains('pointer-events-none')).toBe(true);
  fireEvent.scroll(window);
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.mouseMove(point, { clientX: 450, clientY: 280 });
  expect(screen.getByRole('tooltip').style.left).toBe('288px');
});

it('animates a swap, cancels old animations, and honors reduced motion', () => {
  const cancel = vi.fn(), animate = vi.fn(() => ({ cancel }));
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(this.dataset.primaryChart ? 0 : 700, 0, this.dataset.primaryChart ? 600 : 200, 400);
  });
  vi.stubGlobal('Animation', class {});
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  try {
    const ui = render(<ReadingTrendChart {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '放大查看折线图' }));
    expect(animate).toHaveBeenCalledTimes(4);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    fireEvent.click(screen.getByRole('button', { name: '放大查看热力图' }));
    expect(cancel).toHaveBeenCalledTimes(4); expect(animate).toHaveBeenCalledTimes(4);
    ui.unmount();
  } finally { Reflect.deleteProperty(HTMLElement.prototype, 'animate'); }
});

it('keeps keyboard focus in the same graph when zoom removes the focused date', () => {
  render(<ReadingTrendChart {...props()} />);
  const first = points('柱状图')[0]; act(() => first.focus());
  fireEvent.keyDown(first, { key: '+' });
  expect(points('柱状图')).toContain(document.activeElement);
  expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-23');
});
