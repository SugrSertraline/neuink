/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LibraryHeading } from './LibraryHeading';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('moves overflow actions into more and restores them when widened', () => {
  let width = 180;
  let resize = () => {};
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) { return this.getAttribute('aria-label') === '条目库操作' ? width : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function(this: HTMLElement) { return this.hasAttribute('data-reflow-toolbar-item') ? 100 : this.getAttribute('aria-label') === '更多条目库操作' ? 60 : 0; });
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: () => void) {} observe(el: HTMLElement) { if (el.getAttribute('aria-label') === '条目库操作') resize = this.cb; } disconnect() {} });
  const click = vi.fn();
  render(<LibraryHeading title="很长的标签路径" summary="1 篇论文" ancestors={[]} workspaceRoot={null} hasTagContext={false} view="all" onSelectView={() => {}} onClearFilters={() => {}} onManageTags={() => {}} disabled={false} onNavigate={() => {}} actions={<><button onClick={click}>测试操作</button><button disabled>禁用操作</button></>} />);
  expect(screen.queryByRole('button', { name: '测试操作' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多条目库操作' }));
  fireEvent.click(screen.getByRole('button', { name: '测试操作' }));
  expect(click).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '禁用操作' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '更多条目库操作' }));
  act(() => { width = 800; resize(); });
  expect(screen.queryByRole('button', { name: '更多条目库操作' })).toBeNull();
  expect(screen.getAllByRole('button', { name: '测试操作' })).toHaveLength(1);
});
