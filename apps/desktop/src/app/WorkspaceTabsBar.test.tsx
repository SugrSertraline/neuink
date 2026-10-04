// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceTabsBar } from './WorkspaceTabsBar';
import { surfaceKey, workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from './workspaceSurface';
import { TooltipProvider } from '@/components/ui/tooltip';

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: TestPointerEvent });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      disconnect() {}
      observe() {}
    }
  });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => null
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(callback, 0));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id));
});

afterEach(() => cleanup());

const layout: WorkspaceSurfaceLayout = {
  focusedPane: 'left',
  left: { kind: 'pdf', entryId: 'a' },
  leftTabs: [{ kind: 'pdf', entryId: 'a' }, { kind: 'reflow', entryId: 'a' }],
  right: null,
  rightTabs: []
};

function setup(options: {
  entry?: { id: string; title: string; pdfFileName?: string | null };
  layout?: WorkspaceSurfaceLayout;
} = {}) {
  const onMove = vi.fn();
  const onDuplicate = vi.fn();
  const onSetPinned = vi.fn();
  const onSwitchEntryView = vi.fn();
  const onCloseToRight = vi.fn();
  const onAddToAssistantContext = vi.fn();
  const onSelect = vi.fn();
  const result = render(
    <TooltipProvider>
      <WorkspaceTabsBar
        entries={[options.entry ?? { id: 'a', title: 'Entry A', pdfFileName: 'paper.pdf' }]}
        layout={options.layout ?? layout}
        onAddToAssistantContext={onAddToAssistantContext}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onCloseToRight={onCloseToRight}
        onClosePane={vi.fn()}
        onMove={onMove}
        onDuplicate={onDuplicate}
        onSetPinned={onSetPinned}
        onSwitchEntryView={onSwitchEntryView}
        onSelect={onSelect}
        onSwap={vi.fn()}
      />
    </TooltipProvider>
  );
  const pane = result.container.querySelector<HTMLElement>('[data-workspace-pane="left"]')!;
  const tabs = [...pane.querySelectorAll<HTMLElement>('[data-workspace-tab-index]')];
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 500, 40));
  tabs.forEach((tab, index) => {
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(index * 180, 0, 176, 28));
    Object.defineProperty(tab, 'offsetLeft', { configurable: true, value: index * 180 });
    Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: 176 });
  });
  return { ...result, onAddToAssistantContext, onCloseToRight, onMove, onDuplicate, onSelect, onSetPinned, onSwitchEntryView, tabs };
}

function setupReducer() {
  const initial: WorkspaceSurfaceLayout = {
    focusedPane: 'right',
    left: { kind: 'library' },
    leftTabs: [{ kind: 'library' }],
    right: { kind: 'pdf', entryId: 'a' },
    rightTabs: [{ kind: 'pdf', entryId: 'a' }],
    pinnedTabKeys: []
  };
  let current = initial;
  const onMove = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-workspace-split-drop-target')) return rect(520, 0, 480, 40);
    const pane = this.closest<HTMLElement>('[data-workspace-pane]');
    const left = pane?.dataset.workspacePane === 'right' ? 520 : 0;
    if (this.hasAttribute('data-workspace-pane')) return rect(left, 0, 500, 40);
    if (this.hasAttribute('data-workspace-tab-index')) return rect(left + Number(this.dataset.workspaceTabIndex) * 180, 0, 176, 28);
    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
    return Number(this.dataset.workspaceTabIndex ?? 0) * 180;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-workspace-pane') ? 500 : 176;
  });
  function StatefulTabs() {
    const [state, dispatch] = useReducer(workspaceSurfaceReducer, initial);
    current = state;
    return <TooltipProvider>
      <WorkspaceTabsBar entries={[{ id: 'a', title: 'Entry A', pdfFileName: 'paper.pdf' }]} layout={state}
        onClose={(pane, surface) => dispatch({ type: 'close', pane, key: surfaceKey(surface) })}
        onCloseOthers={(pane, surface) => dispatch({ type: 'closeOthers', pane, key: surfaceKey(surface) })}
        onClosePane={(pane) => dispatch({ type: 'closePane', pane })}
        onMove={(surface, pane, targetIndex) => {
          onMove(surface, pane, targetIndex);
          dispatch({ type: 'move', key: surfaceKey(surface), pane, targetIndex });
        }}
        onSelect={(pane, surface) => dispatch({ type: 'open', pane, surface })}
        onSwap={() => dispatch({ type: 'swap' })} />
    </TooltipProvider>;
  }
  const result = render(<StatefulTabs />);
  const tab = (pane: 'left' | 'right', key: string) => result.container.querySelector<HTMLElement>(
    `[data-workspace-pane="${pane}"] [data-workspace-surface-key="${key}"]`
  )!;
  return { ...result, onMove, tab, state: () => current };
}

describe('WorkspaceTabsBar pointer interaction', () => {
  it('duplicates the selected tab to the other pane without moving it', () => {
    const view = setup();
    fireEvent.contextMenu(view.tabs[0]);
    fireEvent.click(view.getByText('复制到另一分栏'));
    expect(view.onDuplicate).toHaveBeenCalledWith(layout.leftTabs[0], 'right');
    expect(view.onMove).not.toHaveBeenCalled();
  });
  it('shows an interactive entry-view switcher on hover without starting tab drag', async () => {
    const view = setup();
    const trigger = view.tabs[0].querySelector('button')!;
    fireEvent.pointerMove(trigger, { pointerType: 'mouse', buttons: 0 });
    expect(await view.findByText('快速切换视图')).toBeTruthy();

    const reflowButton = view.getByText('重排视图').closest('button')!;
    fireEvent.pointerDown(reflowButton, { button: 0, pointerId: 7, clientX: 30, clientY: 70 });
    fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: 230, clientY: 70 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 230, clientY: 70 });
    fireEvent.click(reflowButton);

    expect(view.onSwitchEntryView).toHaveBeenCalledWith('left', layout.leftTabs[0], 'reflow');
    expect(view.onMove).not.toHaveBeenCalled();
    await waitFor(() => expect(view.queryByText('快速切换视图')).toBeNull());
  });

  it('disables PDF views when the entry has no PDF', async () => {
    const overview: WorkspaceSurfaceLayout = {
      ...layout,
      left: { kind: 'entry-overview', entryId: 'a' },
      leftTabs: [{ kind: 'entry-overview', entryId: 'a' }]
    };
    const view = setup({ entry: { id: 'a', title: 'Entry A' }, layout: overview });
    fireEvent.pointerMove(view.tabs[0].querySelector('button')!, { pointerType: 'mouse', buttons: 0 });
    expect(await view.findByText('快速切换视图')).toBeTruthy();
    expect((view.getByText('PDF').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByText('重排视图').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText('添加 PDF 后可使用 PDF 和重排视图。')).toBeTruthy();
  });

  it('closes the hover switcher when the tab context menu opens', async () => {
    const view = setup();
    const trigger = view.tabs[0].querySelector('button')!;
    fireEvent.pointerMove(trigger, { pointerType: 'mouse', buttons: 0 });
    expect(await view.findByText('快速切换视图')).toBeTruthy();
    fireEvent.contextMenu(trigger);
    expect(view.getByText('固定在标签栏左侧')).toBeTruthy();
    await waitFor(() => expect(view.queryByText('快速切换视图')).toBeNull());
  });

  it('dismisses the hover switcher when a tab drag begins', async () => {
    const view = setup();
    const trigger = view.tabs[0].querySelector('button')!;
    fireEvent.pointerMove(trigger, { pointerType: 'mouse', buttons: 0 });
    expect(await view.findByText('快速切换视图')).toBeTruthy();
    fireEvent.pointerDown(view.tabs[0], { button: 0, pointerId: 8, clientX: 20, clientY: 14 });
    fireEvent.pointerMove(window, { pointerId: 8, buttons: 1, clientX: 220, clientY: 14 });
    await waitFor(() => expect(view.queryByText('快速切换视图')).toBeNull());
    fireEvent.pointerCancel(window, { pointerId: 8 });
    expect(view.onMove).not.toHaveBeenCalled();
  });

  it('opens the tab menu through the app-level context-menu guard', () => {
    const view = setup();
    const intercepted = vi.fn();
    const handleContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-allow-context-menu="true"]')) return;
      intercepted();
      event.preventDefault();
    };
    document.addEventListener('contextmenu', handleContextMenu, true);
    try {
      fireEvent.pointerDown(view.tabs[0], { button: 2, pointerId: 5 });
      fireEvent.contextMenu(view.tabs[0].querySelector('button')!);
      expect(intercepted).not.toHaveBeenCalled();
      expect(view.getByText('固定在标签栏左侧')).toBeTruthy();
    } finally {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      view.unmount();
    }
  });

  it('offers view switching and pinning from the tab context menu without starting a drag', () => {
    const view = setup();
    fireEvent.contextMenu(view.tabs[0]);
    expect(view.getByText('固定在标签栏左侧')).toBeTruthy();
    fireEvent.click(view.getByText('固定在标签栏左侧'));
    expect(view.onSetPinned).toHaveBeenCalledWith(layout.leftTabs[0], true);
    fireEvent.contextMenu(view.tabs[0]);
    fireEvent.click(view.getByText('切换条目视图'));
    fireEvent.click(view.getByText('重排视图'));
    expect(view.onSwitchEntryView).toHaveBeenCalledWith('left', layout.leftTabs[0], 'reflow');
    expect(view.onMove).not.toHaveBeenCalled();
    fireEvent.contextMenu(view.tabs[0]);
    fireEvent.click(view.getByText('关闭右侧标签'));
    expect(view.onCloseToRight).toHaveBeenCalledWith('left', layout.leftTabs[0]);
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur', 'Escape', 'unmount'])('releases tab pointer capture on %s without moving the tab', end => {
    const view = setup();
    const tab = view.tabs[0];
    const capture = vi.fn(); const release = vi.fn();
    tab.setPointerCapture = capture; tab.hasPointerCapture = () => capture.mock.calls.length > 0;
    tab.releasePointerCapture = release;
    fireEvent.pointerDown(tab, { button: 0, clientX: 20, clientY: 14, pointerId: 3 });
    fireEvent.pointerMove(window, { clientX: 22, clientY: 14, pointerId: 3 });
    expect(capture).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 220, clientY: 14, pointerId: 3 });
    expect(capture).toHaveBeenCalledExactlyOnceWith(3);
    if (end === 'unmount') view.unmount();
    else if (end === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (end === 'blur') fireEvent.blur(window);
    else fireEvent(window, new PointerEvent(end, { pointerId: 3 }));
    expect(release).toHaveBeenCalledExactlyOnceWith(3);
    expect(view.onMove).not.toHaveBeenCalled();
    if (end !== 'unmount') view.unmount();
  });
  it('keeps the split exchange button available', () => {
    const onSwap = vi.fn();
    const splitLayout: WorkspaceSurfaceLayout = {
      ...layout,
      right: { kind: 'reflow', entryId: 'a' },
      rightTabs: [{ kind: 'reflow', entryId: 'a' }]
    };
    const { getByLabelText, getByRole } = render(
      <TooltipProvider>
        <WorkspaceTabsBar
          entries={[{ id: 'a', title: 'Entry A' }]}
          layout={splitLayout}
          onClose={vi.fn()}
          onCloseOthers={vi.fn()}
          onClosePane={vi.fn()}
          onMove={vi.fn()}
          onSelect={vi.fn()}
          onSwap={onSwap}
        />
      </TooltipProvider>
    );

    expect(getByLabelText('阅读位置双向联动')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: '交换左右分屏' }));
    expect(onSwap).toHaveBeenCalledOnce();
  });

  it('swaps and drags the final left PDF into one valid pane, then keeps selection and library dragging usable', async () => {
    const view = setupReducer();
    fireEvent.click(view.getByRole('button', { name: '交换左右分屏' }));
    expect(view.tab('left', 'pdf:a')).toBeTruthy();
    expect(view.tab('right', 'library')).toBeTruthy();

    fireEvent.pointerDown(view.tab('left', 'pdf:a'), { button: 0, clientX: 20, clientY: 14, pointerId: 11 });
    fireEvent.pointerMove(window, { clientX: 640, clientY: 14, pointerId: 11 });
    fireEvent.pointerUp(window, { clientX: 640, clientY: 14, pointerId: 11 });
    expect(view.onMove).toHaveBeenCalledExactlyOnceWith({ kind: 'pdf', entryId: 'a' }, 'right', 1);
    expect(view.state().leftTabs.map(surfaceKey)).toEqual(['library', 'pdf:a']);
    expect(surfaceKey(view.state().left)).toBe('pdf:a');
    expect(view.state().right).toBeNull();
    expect(view.container.querySelectorAll('[data-workspace-surface-key="library"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-workspace-surface-key="pdf:a"]')).toHaveLength(1);

    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    fireEvent.click(view.tab('left', 'library').querySelector('button')!);
    expect(surfaceKey(view.state().left)).toBe('library');
    expect(view.state().focusedPane).toBe('left');

    fireEvent.pointerDown(view.tab('left', 'library'), { button: 0, clientX: 20, clientY: 14, pointerId: 12 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 14, pointerId: 12 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 14, pointerId: 12 });
    expect(view.onMove).toHaveBeenCalledTimes(2);
    expect(view.onMove).toHaveBeenLastCalledWith({ kind: 'library' }, 'left', 1);
    expect(view.state().leftTabs.map(surfaceKey)).toEqual(['pdf:a', 'library']);
    expect(surfaceKey(view.state().left)).toBe('library');
    expect(view.state().right).toBeNull();

    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    fireEvent.click(view.tab('left', 'pdf:a').querySelector('button')!);
    expect(surfaceKey(view.state().left)).toBe('pdf:a');
    expect(view.container.querySelectorAll('[data-workspace-surface-key="library"]')).toHaveLength(1);
  });

  it.each(['Escape', 'pointercancel'])('does not commit a cross-pane drag cancelled by %s after swapping', (cancel) => {
    const view = setupReducer();
    fireEvent.click(view.getByRole('button', { name: '交换左右分屏' }));
    const swapped = view.state();
    fireEvent.pointerDown(view.tab('left', 'pdf:a'), { button: 0, clientX: 20, clientY: 14, pointerId: 13 });
    fireEvent.pointerMove(window, { clientX: 640, clientY: 14, pointerId: 13 });
    expect(view.container.querySelector('.is-tab-dragging')).toBeTruthy();
    if (cancel === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.pointerCancel(window, { pointerId: 13 });
    fireEvent.pointerUp(window, { clientX: 640, clientY: 14, pointerId: 13 });
    expect(view.onMove).not.toHaveBeenCalled();
    expect(view.state()).toBe(swapped);
    expect(view.tab('left', 'pdf:a')).toBeTruthy();
    expect(view.tab('right', 'library')).toBeTruthy();
    expect(view.container.querySelector('.is-tab-dragging')).toBeNull();
    expect(document.querySelector('.workspace-tab-drag-preview')).toBeNull();
  });

  it('keeps a normal tab click selectable', () => {
    const { onSelect, tabs } = setup();
    fireEvent.click(tabs[0].querySelector('button')!);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('does not start a drag below the movement threshold', () => {
    const { onMove, tabs } = setup();
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 20, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 22, clientY: 14, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 22, clientY: 14, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('commits the slot selected by the dragged tab center', () => {
    const { onMove, tabs } = setup();
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 20, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 14, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 14, pointerId: 1 });
    expect(onMove).toHaveBeenCalledWith(layout.leftTabs[0], 'left', 1);
  });

  it.each([1, 1.25])('keeps the right-pane insertion slot stable at %s scale while tabs are displaced', (scale) => {
    const rightLeft = 640;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-workspace-pane')) {
        return rect(this.dataset.workspacePane === 'right' ? rightLeft : 0, 0, 500 * scale, 40 * scale);
      }
      return rect(0, 0, 0, 0);
    });
    const view = setup({ layout: {
      ...layout,
      leftTabs: [layout.left],
      right: { kind: 'reflow', entryId: 'a' },
      rightTabs: [{ kind: 'library' }, { kind: 'reflow', entryId: 'a' }]
    } });
    const pane = view.container.querySelector<HTMLElement>('[data-workspace-pane="right"]')!;
    Object.defineProperty(pane, 'offsetWidth', { configurable: true, value: 500 });
    const targetTabs = [...pane.querySelectorAll<HTMLElement>('[data-workspace-tab-index]')];
    expect(targetTabs).toHaveLength(2);
    targetTabs.forEach((tab, index) => {
      Object.defineProperty(tab, 'offsetLeft', { configurable: true, value: index * 180 });
      Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: 176 });
      vi.spyOn(tab, 'getBoundingClientRect').mockImplementation(() =>
        rect(rightLeft + (index * 180 + (tab.style.transform ? 180 : 0)) * scale, 0, 176 * scale, 28 * scale));
    });
    vi.spyOn(view.tabs[0], 'getBoundingClientRect').mockReturnValue(rect(0, 0, 176 * scale, 28 * scale));
    const pointerX = rightLeft + (240 - 68) * scale;
    fireEvent.pointerDown(view.tabs[0], { button: 0, clientX: 20 * scale, clientY: 14 * scale, pointerId: 14 });
    fireEvent.pointerMove(window, { clientX: pointerX, clientY: 14 * scale, pointerId: 14 });
    expect(targetTabs[1].style.transform).toBe('translateX(180px)');
    expect(targetTabs[1].getBoundingClientRect().left).toBe(rightLeft + 360 * scale);
    fireEvent.pointerMove(window, { clientX: pointerX, clientY: 14 * scale, pointerId: 14 });
    fireEvent.pointerUp(window, { clientX: pointerX, clientY: 14 * scale, pointerId: 14 });
    expect(view.onMove).toHaveBeenCalledExactlyOnceWith(layout.left, 'right', 1);
  });

  it('accepts a drop anywhere inside the workspace pane, not only in the tab bar', () => {
    const { onMove, tabs } = setup();
    const contentDropZone = document.createElement('div');
    contentDropZone.dataset.workspaceDropPane = 'right';
    contentDropZone.dataset.workspaceTabCount = '0';
    document.body.append(contentDropZone);
    vi.spyOn(contentDropZone, 'getBoundingClientRect').mockReturnValue(rect(520, 40, 480, 700));

    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 20, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 640, clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 640, clientY: 320, pointerId: 1 });

    expect(onMove).toHaveBeenCalledWith(layout.leftTabs[0], 'right', 0);
    contentDropZone.remove();
  });

  it('adds a document tab to assistant context when dropped on the assistant panel', () => {
    const { onAddToAssistantContext, onMove, tabs } = setup();
    const assistantDropZone = document.createElement('aside');
    assistantDropZone.dataset.assistantContextDropzone = 'true';
    const dropTarget = document.createElement('div');
    assistantDropZone.append(dropTarget);
    document.body.append(assistantDropZone);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(dropTarget);

    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 20, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 640, clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 640, clientY: 320, pointerId: 1 });

    expect(onAddToAssistantContext).toHaveBeenCalledWith(layout.leftTabs[0]);
    expect(onMove).not.toHaveBeenCalled();
    assistantDropZone.remove();
  });

  it('does not add a tool tab to assistant context', () => {
    const onAddToAssistantContext = vi.fn();
    const toolLayout: WorkspaceSurfaceLayout = {
      ...layout,
      left: { kind: 'settings' },
      leftTabs: [{ kind: 'settings' }]
    };
    const { container } = render(
      <TooltipProvider>
        <WorkspaceTabsBar
          entries={[{ id: 'a', title: 'Entry A' }]}
          layout={toolLayout}
          onAddToAssistantContext={onAddToAssistantContext}
          onClose={vi.fn()}
          onCloseOthers={vi.fn()}
          onClosePane={vi.fn()}
          onMove={vi.fn()}
          onSelect={vi.fn()}
          onSwap={vi.fn()}
        />
      </TooltipProvider>
    );
    const tab = container.querySelector<HTMLElement>('[data-workspace-tab-index="0"]')!;
    vi.spyOn(tab, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 176, 28));
    const assistantDropZone = document.createElement('aside');
    assistantDropZone.dataset.assistantContextDropzone = 'true';
    document.body.append(assistantDropZone);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(assistantDropZone);

    fireEvent.pointerDown(tab, { button: 0, clientX: 20, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 640, clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 640, clientY: 320, pointerId: 1 });

    expect(onAddToAssistantContext).not.toHaveBeenCalled();
    assistantDropZone.remove();
  });

  it('cancels an active drag with Escape', () => {
    const { onMove, tabs } = setup();
    fireEvent.pointerDown(tabs[0], { button: 0, clientX: 20, clientY: 14, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 14, pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { clientX: 220, clientY: 14, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}
