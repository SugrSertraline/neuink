// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarPanel } from './SidebarPanel';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('caps expanded panels to their content and remeasures loaded content without remounting or reordering headers', () => {
  let contentHeight = 96;
  const observers: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.slot === 'sidebar-panel-content' ? contentHeight : this.dataset.slot === 'sidebar-panel-header' ? 28 : 0;
  });
  const view = render(<>
    <SidebarPanel name="条目" label="条目" open onToggle={() => {}}><input aria-label="筛选" /></SidebarPanel>
    <SidebarPanel name="标签" label="标签" open={false} onToggle={() => {}}>标签内容</SidebarPanel>
  </>);
  const panel = view.container.querySelector<HTMLElement>('[data-sidebar-panel="条目"]')!;
  const input = view.getByRole('textbox', { name: '筛选' });
  expect(panel.style.maxHeight).toBe('125px');
  contentHeight = 220;
  act(() => observers.forEach(callback => callback()));
  expect(panel.style.maxHeight).toBe('249px');
  expect(view.getByRole('textbox', { name: '筛选' })).toBe(input);
  expect([...view.container.querySelectorAll('[data-sidebar-panel]')].map(element => element.getAttribute('data-sidebar-panel'))).toEqual(['条目', '标签']);
  expect(view.container.querySelector<HTMLElement>('[data-sidebar-panel="标签"]')!.style.maxHeight).toBe('');
});

it('keeps panel content mounted, restores scroll and exposes keyboard collapse without triggering header actions', () => {
  const action = vi.fn();
  function Panel() {
    const [open, setOpen] = useState(true);
    return <SidebarPanel name="论文" label="论文" open={open} onToggle={() => setOpen(value => !value)} action={<button onClick={action}>新建</button>}><input aria-label="草稿" defaultValue="保留" /></SidebarPanel>;
  }
  const view = render(<Panel />);
  const header = view.getByRole('button', { name: '论文' });
  const viewport = view.container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
  viewport.scrollTop = 320;
  fireEvent.scroll(viewport);
  fireEvent.click(view.getByRole('button', { name: '新建' }));
  expect(header.getAttribute('aria-expanded')).toBe('true');
  expect(action).toHaveBeenCalledOnce();
  const draft = view.getByRole('textbox', { name: '草稿' });
  fireEvent.keyDown(header, { key: 'ArrowLeft' });
  expect(view.queryByRole('textbox', { name: '草稿' })).toBeNull();
  expect(draft.isConnected).toBe(true);
  expect(document.getElementById(header.getAttribute('aria-controls')!)?.hidden).toBe(true);
  viewport.scrollTop = 0;
  fireEvent.scroll(viewport);
  fireEvent.keyDown(header, { key: 'ArrowRight' });
  expect(viewport.scrollTop).toBe(320);
  expect(view.getByRole('textbox', { name: '草稿' })).toBe(draft);
});
