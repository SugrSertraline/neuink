// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { useReducer, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActivityNavigation } from './ActivityNavigation';
import { WorkspaceSidebar, SidebarPanelSlot } from './WorkspaceSidebar';
import { WorkspaceTabsBar } from './WorkspaceTabsBar';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { hasUnsavedSurface } from './editSafety';
import { workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from './workspaceSurface';
import type { SidePanel } from './activityBarState';

vi.mock('./editSafety', () => ({ hasUnsavedSurface: vi.fn(() => false) }));
beforeEach(() => {
  vi.mocked(hasUnsavedSurface).mockReturnValue(false);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 40));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const initial: WorkspaceSurfaceLayout = {
  focusedPane: 'left', left: { kind: 'library' },
  leftTabs: [{ kind: 'library' }, { kind: 'daily-dashboard' }, { kind: 'pdf', entryId: 'paper' }],
  right: null, rightTabs: [],
};

function Host() {
  const [layout, dispatch] = useReducer(workspaceSurfaceReducer, initial);
  const [panel, setPanel] = useState<SidePanel>('library');
  const open = useWorkspaceNavigation({ layout, dispatch, prepareSplit: vi.fn(), onBlockedMove: vi.fn(), onSelectPage: setPanel });
  return <TooltipProvider>
    <div aria-label="工作区标签"><WorkspaceTabsBar entries={[]} layout={layout}
      onSelect={(pane, surface) => open(surface, pane)} onClose={vi.fn()} onCloseOthers={vi.fn()}
      onClosePane={vi.fn()} onMove={vi.fn()} onSwap={vi.fn()} /></div>
    <ActivityNavigation focusedKind={layout.left.kind} activePanel={panel} noteDetails={false}
      onOpenPage={page => open({ kind: page })} onOpenRight={page => open({ kind: page }, 'right')} onSelectTool={setPanel} />
    <button onClick={() => open({ kind: 'daily-dashboard' })}>阅读统计入口</button>
    <WorkspaceSidebar open>
      <SidebarPanelSlot active={panel === 'daily-dashboard'}><aside className="app-sidebar" aria-label="当前侧栏">每日智能建议</aside></SidebarPanelSlot>
      {panel === 'library' ? <aside className="app-sidebar" aria-label="当前侧栏">条目库导航</aside> : null}
      <SidebarPanelSlot active={panel === 'assistant'}><aside className="app-sidebar" aria-label="当前侧栏">assistant<input aria-label="对话草稿" defaultValue="保留草稿" /></aside></SidebarPanelSlot>
    </WorkspaceSidebar>
    <output aria-label="当前页面">{layout.left.kind}</output>
  </TooltipProvider>;
}

it.each(['tab', 'statistics', 'rail'])('switches library → dashboard → library with the matching sidebar through %s', entry => {
  const ui = render(<Host />);
  const tabs = within(ui.getByLabelText('工作区标签'));
  const rail = within(ui.getByRole('navigation', { name: '主导航' }));
  fireEvent.click(entry === 'tab' ? tabs.getByRole('button', { name: '每日看板' })
    : entry === 'statistics' ? ui.getByRole('button', { name: '阅读统计入口' }) : rail.getByRole('button', { name: '每日看板' }));
  expect(ui.getByLabelText('当前页面').textContent).toBe('daily-dashboard');
  expect(ui.getByRole('complementary', { name: '当前侧栏' }).textContent).toBe('每日智能建议');
  expect(rail.getByRole('button', { name: '每日看板' }).getAttribute('aria-current')).toBe('true');
  fireEvent.click(tabs.getByRole('button', { name: '条目库' }));
  expect(ui.getByRole('complementary', { name: '当前侧栏' }).textContent).toBe('条目库导航');
  expect(rail.getByRole('button', { name: '条目库' }).getAttribute('aria-current')).toBe('true');
});

it('restores daily advice when reselecting an already-active dashboard tab after using the assistant', () => {
  const ui = render(<Host />);
  const tabs = within(ui.getByLabelText('工作区标签'));
  const rail = within(ui.getByRole('navigation', { name: '主导航' }));
  fireEvent.click(tabs.getByRole('button', { name: '每日看板' }));
  fireEvent.click(rail.getByRole('button', { name: '助手' }));
  expect(ui.getByRole('complementary', { name: '当前侧栏' }).textContent).toContain('assistant');
  fireEvent.click(tabs.getByRole('button', { name: '每日看板' }));
  fireEvent.click(tabs.getByRole('button', { name: '每日看板' }));
  expect(ui.getByRole('complementary', { name: '当前侧栏' }).textContent).toBe('每日智能建议');
  expect(ui.container.querySelectorAll('.activitybar-group button.active')).toHaveLength(1);
});

it('keeps the chosen search tool when opening a paper', () => {
  const onSelectPage = vi.fn(), dispatch = vi.fn();
  const { result } = renderHook(() => useWorkspaceNavigation({ layout: initial, dispatch,
    prepareSplit: vi.fn(), onBlockedMove: vi.fn(), onSelectPage }));
  act(() => { result.current({ kind: 'pdf', entryId: 'paper' }); });
  expect(onSelectPage).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'open', surface: { kind: 'pdf', entryId: 'paper' } }));
});

it.each([false, true])('preserves split placement and save protection before selecting the sidebar (blocked=%s)', blocked => {
  vi.mocked(hasUnsavedSurface).mockReturnValue(blocked);
  const dispatch = vi.fn(), prepareSplit = vi.fn(), onBlockedMove = vi.fn(), onSelectPage = vi.fn();
  const { result } = renderHook(() => useWorkspaceNavigation({ layout: initial, dispatch, prepareSplit, onBlockedMove, onSelectPage }));
  let opened = false;
  act(() => { opened = result.current({ kind: 'daily-dashboard' }, 'right'); });
  expect(opened).toBe(!blocked);
  if (blocked) {
    expect(onBlockedMove).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled(); expect(prepareSplit).not.toHaveBeenCalled(); expect(onSelectPage).not.toHaveBeenCalled();
  } else {
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'move', key: 'daily-dashboard', pane: 'right' });
    expect(prepareSplit).toHaveBeenCalledWith({ kind: 'daily-dashboard' });
    expect(onSelectPage).toHaveBeenCalledWith('daily-dashboard');
  }
});

it('keeps one visible sidebar when switching panels and preserves the hidden assistant draft', () => {
  const ui = render(<Host />);
  const rail = within(ui.getByRole('navigation', { name: '主导航' }));
  fireEvent.click(rail.getByRole('button', { name: '助手' }));
  fireEvent.change(ui.getByRole('textbox', { name: '对话草稿' }), { target: { value: '尚未发送的提问' } });
  for (const name of ['条目库', '每日看板', '条目库', '每日看板', '助手']) {
    fireEvent.click(rail.getByRole('button', { name }));
    expect(ui.getAllByRole('complementary', { name: '当前侧栏' })).toHaveLength(1);
    expect(ui.container.querySelectorAll('.activitybar-group button.active')).toHaveLength(1);
    if (name === '每日看板') expect(ui.queryByText('条目库导航')).toBeNull();
  }
  expect((ui.getByRole('textbox', { name: '对话草稿' }) as HTMLInputElement).value).toBe('尚未发送的提问');
});
