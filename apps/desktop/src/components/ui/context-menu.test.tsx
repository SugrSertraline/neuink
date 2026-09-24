// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from './context-menu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('supports portalled submenus, restores keyboard focus and forwards the content ref without warnings', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const ref = createRef<HTMLDivElement>();
  const onSelect = vi.fn();
  const view = render(<ContextMenu><ContextMenuTrigger asChild><button>论文</button></ContextMenuTrigger>
    <ContextMenuContent viewportAligned>
      <ContextMenuSub><ContextMenuSubTrigger>在右侧打开</ContextMenuSubTrigger>
        <ContextMenuPortal><ContextMenuSubContent ref={ref}>
          <ContextMenuItem onSelect={onSelect}>阅读摘要</ContextMenuItem>
        </ContextMenuSubContent></ContextMenuPortal>
      </ContextMenuSub>
    </ContextMenuContent>
  </ContextMenu>);
  const trigger = view.getByRole('button', { name: '论文' });
  act(() => trigger.focus());
  fireEvent.contextMenu(trigger, { clientX: 50, clientY: 60 });
  const subTrigger = await view.findByRole('menuitem', { name: '在右侧打开' });
  fireEvent.keyDown(subTrigger, { key: 'ArrowRight' });
  const submenu = await view.findByRole('menu', { name: '在右侧打开' });
  expect(ref.current).toBe(submenu);
  expect(errors).not.toHaveBeenCalled();
  fireEvent.keyDown(within(submenu).getByRole('menuitem', { name: '阅读摘要' }), { key: 'ArrowLeft' });
  await waitFor(() => expect(document.activeElement).toBe(subTrigger));
  fireEvent.keyDown(subTrigger, { key: 'ArrowRight' });
  fireEvent.click(await view.findByRole('menuitem', { name: '阅读摘要' }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(ref.current).toBeNull();
  expect(errors).not.toHaveBeenCalled();
});
