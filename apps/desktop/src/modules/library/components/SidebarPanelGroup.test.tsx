// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarPanel } from './SidebarPanel';
import { SidebarPanelGroup } from './SidebarPanelGroup';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Demo() {
  const [middle, setMiddle] = useState(true);
  return <SidebarPanelGroup>
    <SidebarPanel name="标签" label="标签" open onToggle={() => {}}>标签内容</SidebarPanel>
    <SidebarPanel name="论文" label="论文" open={middle} onToggle={() => setMiddle(value => !value)} weight={2}>论文内容</SidebarPanel>
    <SidebarPanel name="笔记" label="笔记" open onToggle={() => {}}>笔记内容</SidebarPanel>
  </SidebarPanelGroup>;
}
function setup() {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.dataset.slot === 'sidebar-panel-header' ? 28 : this.dataset.slot === 'sidebar-panel-content' ? 71 : 0;
  });
  const view = render(<Demo />);
  const panels = [...view.container.querySelectorAll<HTMLElement>('[data-sidebar-panel]')];
  panels.forEach((panel, index) => {
    const height = () => panel.style.flexBasis.endsWith('px') ? parseFloat(panel.style.flexBasis) : index === 1 ? 200 : 100;
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: height });
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => ({ height: height() * 1.25 } as DOMRect));
  });
  return { ...view, panels, handle: view.getByRole('separator', { name: '调整标签与论文高度' }) };
}

it('resizes adjacent panels at UI zoom without moving the third panel or replacing scroll owners', () => {
  const view = setup();
  const scroll = view.panels[1].querySelector('[data-slot="scroll-area-viewport"]');
  expect(view.panels[0].style.maxHeight).toBe('100px');
  fireEvent.pointerDown(view.handle, { button: 0, pointerId: 1, clientY: 100 });
  expect(view.container.querySelector('[data-sidebar-panel-group]')?.getAttribute('data-resizing')).toBe('true');
  fireEvent.pointerMove(window, { pointerId: 2, clientY: 180 });
  expect(view.panels[0].style.flexGrow).toBe('1');
  fireEvent.pointerMove(window, { pointerId: 1, clientY: 102 });
  expect(view.panels[0].style.flexGrow).toBe('1');
  fireEvent.pointerMove(window, { pointerId: 1, clientY: 150 });
  expect(view.panels[0].style.flexBasis).toBe('140px');
  expect(view.panels[0].style.maxHeight).toBe('');
  expect(view.panels[1].style.flexBasis).toBe('160px');
  expect(view.panels[2].style.flexBasis).toBe('100px');
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(view.container.querySelector('[data-resizing]')).toBeNull();
  expect(document.body.style.cursor).toBe('');
  expect(view.panels[1].querySelector('[data-slot="scroll-area-viewport"]')).toBe(scroll);
});

it.each(['Escape', 'pointercancel', 'blur', 'resize'])('rolls back and cleans up on %s', reason => {
  const view = setup();
  fireEvent.pointerDown(view.handle, { button: 0, clientY: 100 });
  fireEvent.pointerMove(window, { clientY: 200 });
  if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  else fireEvent(window, new Event(reason));
  expect(view.panels[0].style.flexGrow).toBe('1');
  expect(view.panels[0].style.maxHeight).toBe('100px');
  expect(document.body.style.userSelect).toBe('');
  expect(view.container.querySelector('[data-resizing]')).toBeNull();
  fireEvent.pointerMove(window, { clientY: 300 });
  expect(view.panels[0].style.flexGrow).toBe('1');
});

it('clamps minimum height, allows keyboard adjustment, and skips collapsed panels', () => {
  const view = setup();
  fireEvent.pointerDown(view.handle, { button: 0, clientY: 100 });
  fireEvent.pointerMove(window, { clientY: -1000 });
  fireEvent.pointerUp(window);
  expect(view.panels[0].style.flexBasis).toBe('56px');
  fireEvent.keyDown(view.handle, { key: 'ArrowDown' });
  expect(view.panels[0].style.flexBasis).toBe('64px');
  fireEvent.click(view.getByRole('button', { name: '论文' }));
  expect(view.queryByRole('separator', { name: '调整标签与论文高度' })).toBeNull();
  expect(view.getByRole('separator', { name: '调整标签与笔记高度' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '论文' }));
  expect(view.getAllByRole('separator')).toHaveLength(2);
  expect(view.panels[0].style.flexBasis).toBe('64px');
});

it('cancels an active drag when a panel collapses or the group unmounts', () => {
  const view = setup();
  fireEvent.pointerDown(view.handle, { button: 0, clientY: 100 });
  fireEvent.pointerMove(window, { clientY: 150 });
  fireEvent.click(view.getByRole('button', { name: '论文' }));
  expect(document.body.style.cursor).toBe('');
  expect(view.panels[0].style.flexGrow).toBe('1');
  fireEvent.pointerDown(view.getByRole('separator'), { button: 0, clientY: 100 });
  view.unmount();
  expect(document.body.style.userSelect).toBe('');
});
