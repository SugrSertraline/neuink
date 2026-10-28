// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarBoundaryControl } from './SidebarBoundaryControl';

afterEach(cleanup);
const props = { width: 360, minWidth: 220, maxWidth: 820, onExpand: vi.fn(), onPointerDown: vi.fn(), onKeyDown: vi.fn() };

it('keeps the resize grip and transfers focus to the boundary arrow only when collapsed', () => {
  const view = render(<SidebarBoundaryControl {...props} open />);
  const grip = screen.getByRole('separator', { name: '调整侧栏宽度' });
  expect(grip.getAttribute('aria-valuenow')).toBe('360');
  expect(grip.querySelector('.lucide-grip-vertical')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '打开侧栏' })).toBeNull();
  view.rerender(<SidebarBoundaryControl {...props} open={false} />);
  const arrow = screen.getByRole('button', { name: '打开侧栏' });
  expect(arrow.classList.contains('app-sidebar-expander')).toBe(true);
  expect(arrow.querySelector('.lucide-chevron-right')).toBeTruthy();
  expect(screen.queryByRole('separator')).toBeNull();
  expect(document.activeElement).toBe(arrow);
  fireEvent.click(arrow);
  expect(props.onExpand).toHaveBeenCalledTimes(1);
  view.rerender(<SidebarBoundaryControl {...props} open />);
  expect(document.activeElement).toBe(screen.getByRole('separator'));
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('360');
});
