// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { SearchDialog } from './SearchDialog';
import { SearchPanel } from './SearchPanel';
import { isIdeationCommand } from './IdeationCommand';
const search = vi.hoisted(() => vi.fn((_options: { query: string }) => ({ busy: false, error: null, results: null })));
vi.mock('../hooks/useGlobalSearch', () => ({ useGlobalSearch: search }));
vi.mock('../hooks/useEmbeddingStatus', () => ({ useEmbeddingStatus: () => ({}) }));
vi.mock('../hooks/useSearchIndexBuildStatus', () => ({ useSearchIndexBuildStatus: () => ({}) }));
vi.mock('../hooks/useSearchIndexStatus', () => ({ useSearchIndexStatus: () => ({}) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(panel: boolean, root: string | null = 'test', status: 'ready' | 'loading' | 'error' = 'ready', accepted = true) {
  const open = vi.fn(() => accepted), close = vi.fn();
  render(<ToastContext.Provider value={{ notify: vi.fn(() => 'id'), dismiss: vi.fn() }}>
    {panel ? <SearchPanel root={root} status={status} onOpenResult={vi.fn()} onOpenIdeation={open} />
      : <SearchDialog open root={root} status={status} onOpenResult={vi.fn()} onOpenIdeation={open} onOpenChange={close} />}
  </ToastContext.Provider>);
  return { open, close, input: screen.getByRole('combobox', { name: panel ? '搜索资料' : '全局搜索' }) };
}
it('only recognizes the exact deliberate command', () => {
  expect(isIdeationCommand(' /INSPIRATION ')).toBe(true);
  for (const q of ['', '/insp', '灵感', '研究构思', '/inspiration paper']) expect(isIdeationCommand(q)).toBe(false);
});
it.each([true, false])('requires explicit activation, skips searching command text, respects IME and closes only after opening (%s)', async panel => {
  const { input, open, close } = setup(panel);
  expect(screen.queryByText('打开研究构思')).toBeNull();
  fireEvent.change(input, { target: { value: '/inspiration' } });
  const item = screen.getByRole('option', { name: /打开研究构思/ });
  expect(open).not.toHaveBeenCalled();
  expect(search.mock.lastCall?.[0]).toMatchObject({ query: '' });
  await waitFor(() => expect(item.getAttribute('data-selected')).toBe('true'));
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(open).toHaveBeenCalledOnce();
  if (!panel) expect(close).toHaveBeenCalledWith(false);
  expect((input as HTMLInputElement).value).toBe('');
});
it.each(['loading', 'error', 'ready'] as const)('disables the command without an available workspace (%s)', status => {
  const { input, open } = setup(false, status === 'ready' ? null : 'test', status);
  fireEvent.change(input, { target: { value: '/inspiration' } });
  const item = screen.getByRole('option', { name: /打开研究构思/ });
  expect(item.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(item);
  expect(open).not.toHaveBeenCalled();
});
it('keeps search open when navigation is rejected by edit protection', () => {
  const { input, close, open } = setup(false, 'test', 'ready', false);
  fireEvent.change(input, { target: { value: '/inspiration' } });
  fireEvent.click(screen.getByRole('option', { name: /打开研究构思/ }));
  expect(open).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect((input as HTMLInputElement).value).toBe('/inspiration');
});
