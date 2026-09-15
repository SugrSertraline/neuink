// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SidebarPanel } from './SidebarPanel';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
