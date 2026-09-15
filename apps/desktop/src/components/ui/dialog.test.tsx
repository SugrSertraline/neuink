// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

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
});
