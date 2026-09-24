// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

afterEach(cleanup);
describe('Dialog bounded layout', () => {
  it('opts in to a stable frame with only the body scrolling and keeps the keyboard close contract', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange}>
      <DialogContent layout="bounded">
        <DialogHeader><DialogTitle>导出</DialogTitle><DialogDescription>导出选项</DialogDescription></DialogHeader>
        <DialogBody role="region" aria-label="导出内容" tabIndex={0}>Long content</DialogBody>
        <DialogFooter><button>保存</button></DialogFooter>
      </DialogContent>
    </Dialog>);
    const dialog = screen.getByRole('dialog');
    const body = screen.getByRole('region', { name: '导出内容' });
    expect(dialog.dataset.layout).toBe('bounded');
    expect(dialog.className).toContain('h-[min(42rem,calc(100%-2rem))]');
    expect(dialog.className).toContain('sm:max-w-[38rem]');
    expect(dialog.className).not.toContain('sm:max-w-sm');
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('[scrollbar-gutter:stable]');
    expect(body.className).toContain('[overflow-anchor:none]');
    expect(dialog.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
    expect(body.contains(dialog.querySelector('[data-slot="dialog-header"]'))).toBe(false);
    expect(body.contains(screen.getByRole('button', { name: '保存' }))).toBe(false);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not change the size contract of existing dialogs', () => {
    render(<Dialog open><DialogContent><DialogTitle>原有弹窗</DialogTitle><DialogDescription>说明</DialogDescription></DialogContent></Dialog>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.dataset.layout).toBe('default');
    expect(dialog.className).toContain('sm:max-w-sm');
    expect(dialog.className).not.toContain('h-[min(42rem,calc(100%-2rem))]');
  });
  it('keeps a nested popover above the dialog and Escape returns focus to its trigger', async () => {
    render(<Dialog defaultOpen><DialogContent><DialogTitle>设置</DialogTitle><DialogDescription>阅读设置</DialogDescription>
      <Popover><PopoverTrigger>阅读选项</PopoverTrigger><PopoverContent viewportAligned><button>当前论文</button></PopoverContent></Popover>
    </DialogContent></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: '阅读选项' }));
    const content = screen.getByRole('button', { name: '当前论文' }).closest('[data-slot="popover-content"]')!;
    expect(content.className).toContain('z-[var(--z-dialog-popover)]');
    expect(content.closest('[data-slot="overlay-viewport"]')?.className).toContain('z-[var(--z-dialog-popover)]');
    fireEvent.keyDown(content, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '当前论文' })).toBeNull());
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '阅读选项' })));
  });
});
