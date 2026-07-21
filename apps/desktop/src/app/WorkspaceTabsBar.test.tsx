// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const layout: WorkspaceSurfaceLayout = {
  focusedPane: 'left',
  left: { kind: 'pdf', entryId: 'a' },
  leftTabs: [{ kind: 'pdf', entryId: 'a' }, { kind: 'reflow', entryId: 'a' }],
  right: null,
  rightTabs: []
};

function setup() {
  const onMove = vi.fn();
  const onAddToAssistantContext = vi.fn();
  const onSelect = vi.fn();
  const result = render(
    <TooltipProvider>
      <WorkspaceTabsBar
        entries={[{ id: 'a', title: 'Entry A' }]}
        layout={layout}
        onAddToAssistantContext={onAddToAssistantContext}
        onClose={vi.fn()}
        onCloseOthers={vi.fn()}
        onClosePane={vi.fn()}
        onMove={onMove}
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
  return { ...result, onAddToAssistantContext, onMove, onSelect, tabs };
}

describe('WorkspaceTabsBar pointer interaction', () => {
  it('keeps the split exchange button available', () => {
    const onSwap = vi.fn();
    const splitLayout: WorkspaceSurfaceLayout = {
      ...layout,
      right: { kind: 'reflow', entryId: 'a' },
      rightTabs: [{ kind: 'reflow', entryId: 'a' }]
    };
    const { getByRole } = render(
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
