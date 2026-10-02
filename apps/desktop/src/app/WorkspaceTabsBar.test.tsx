// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceTabsBar } from './WorkspaceTabsBar';
import type { WorkspaceSurfaceLayout } from './workspaceSurface';
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
