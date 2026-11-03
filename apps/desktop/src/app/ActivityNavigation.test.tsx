// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { WorkspaceSurface } from './workspaceSurface';
import type { SidePanel } from './activityBarState';
import { ActivityNavigation } from './ActivityNavigation';
import { SidebarBoundaryControl } from './SidebarBoundaryControl';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const callbacks = () => ({ onOpenPage: vi.fn(), onOpenRight: vi.fn(), onSelectTool: vi.fn(), onCloseSidebar: vi.fn() });

it('shares one persistent highlight across all six destinations and gives the visible sidebar priority', () => {
  const props = { ...callbacks(), noteDetails: false };
  const view = render(<TooltipProvider><ActivityNavigation {...props} focusedKind="daily-dashboard" activePanel="assistant" /></TooltipProvider>);
  const group = screen.getByRole('group', { name: '工作区导航' });
  const slider = group.querySelector('.activitybar-slider');
  expect(within(group).getAllByRole('button')).toHaveLength(6);
  const states: [WorkspaceSurface['kind'], SidePanel | null, string][] = [
    ['daily-dashboard', 'assistant', '助手'],
    ['daily-dashboard', null, '每日看板'],
    ['library', 'library', '条目库'],
    ['library', 'details', '条目详情'],
    ['library', 'search', '搜索'],
    ['library', 'same-tag', '标签阅读'],
    ['pdf', 'library', '条目库'],
    ['library', null, '条目库'],
  ];
  const positions = new Set();
  for (const [focusedKind, activePanel, label] of states) {
    view.rerender(<TooltipProvider><ActivityNavigation {...props} focusedKind={focusedKind} activePanel={activePanel} /></TooltipProvider>);
    expect(group.querySelectorAll('button.active')).toHaveLength(1);
    expect(group.querySelector('button.active')?.getAttribute('aria-label')).toBe(label);
    expect(group.querySelectorAll('[aria-current="true"], [aria-pressed="true"]')).toHaveLength(1);
    expect(group.querySelector('.activitybar-slider')).toBe(slider);
    expect(slider?.getAttribute('data-visible')).toBe('true');
    positions.add(slider?.getAttribute('style'));
  }
  expect(positions.size).toBe(6);
  view.rerender(<TooltipProvider><ActivityNavigation {...props} focusedKind="pdf" activePanel={null} /></TooltipProvider>);
  expect(group.querySelectorAll('button.active')).toHaveLength(0);
  expect(slider?.getAttribute('data-visible')).toBe('false');
});

it('opens pages and different tools while keeping the current tool selected', () => {
  const props = callbacks();
  render(<TooltipProvider><ActivityNavigation {...props} focusedKind="daily-dashboard" activePanel="search" noteDetails /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: '每日看板' }));
  fireEvent.click(screen.getByRole('button', { name: '条目库' }));
  expect(props.onOpenPage.mock.calls).toEqual([['daily-dashboard'], ['library']]);
  fireEvent.contextMenu(screen.getByRole('button', { name: '每日看板' }));
  expect(props.onOpenRight).toHaveBeenCalledWith('daily-dashboard');
  for (const label of ['笔记详情', '搜索', '助手', '标签阅读']) fireEvent.click(screen.getByRole('button', { name: label }));
  expect(props.onSelectTool.mock.calls).toEqual([['details'], ['assistant'], ['same-tag']]);
  expect(props.onCloseSidebar).toHaveBeenCalledTimes(1);
});

it('toggles all six panels closed and restores the last panel without opening a page', () => {
  const opened = vi.fn();
  function Rail() {
    const [page, setPage] = useState<WorkspaceSurface['kind']>('daily-dashboard');
    const [panel, setPanel] = useState<SidePanel>('daily-dashboard');
    const [open, setOpen] = useState(true);
    return <TooltipProvider><ActivityNavigation focusedKind={page} activePanel={open ? panel : null} noteDetails={false}
      onCloseSidebar={() => setOpen(false)}
      onOpenPage={next => { opened(next); setPage(next); if (next !== 'settings') setPanel(next); setOpen(true); }}
      onOpenRight={vi.fn()} onSelectTool={next => { setPanel(next); setOpen(true); }} />
      <SidebarBoundaryControl open={open} width={280} minWidth={220} maxWidth={820} onExpand={() => setOpen(true)} onPointerDown={vi.fn()} onKeyDown={vi.fn()} />
    </TooltipProvider>;
  }
  render(<Rail />);
  for (const name of ['条目库', '条目详情', '搜索', '助手', '标签阅读', '每日看板']) {
    const button = screen.getByRole('button', { name });
    fireEvent.click(button);
    expect(screen.getByRole('separator', { name: '调整侧栏宽度' })).toBeTruthy();
    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: '打开侧栏' })).toBeNull();
    fireEvent.click(button);
    const opener = screen.getByRole('button', { name: '打开侧栏' });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(opener);
    const calls = opened.mock.calls.length;
    fireEvent.click(opener);
    expect(opened).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole('separator', { name: '调整侧栏宽度' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '收起侧栏' })).toBeNull();
    expect(button.classList.contains('active')).toBe(true);
  }
});

it('can reopen a collapsed sidebar and open the library from a reading page', () => {
  const props = callbacks();
  const ui = render(<TooltipProvider><ActivityNavigation {...props} focusedKind="library" activePanel={null} noteDetails={false} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: '条目库' }));
  expect(props.onOpenPage).toHaveBeenCalledWith('library');
  ui.rerender(<TooltipProvider><ActivityNavigation {...props} focusedKind="pdf" activePanel="library" noteDetails={false} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: '条目库' }));
  expect(props.onOpenPage).toHaveBeenCalledTimes(1);
  expect(props.onCloseSidebar).toHaveBeenCalledTimes(1);
  ui.rerender(<TooltipProvider><ActivityNavigation {...props} focusedKind="pdf" activePanel={null} noteDetails={false} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: '助手' }));
  expect(props.onSelectTool).toHaveBeenCalledWith('assistant');
});
