// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UnsavedWindowDialog } from './UnsavedWindowDialog';
afterEach(cleanup);
it('offers discard rather than backup for paper metadata', () => {
  const discard = vi.fn();
  render(<UnsavedWindowDialog targets={[{ scopeKey: 'entry-overview:test', ownerId: 'entry-metadata:test', handler: undefined }]} busy={false} error={null} onEdit={() => {}} onCancel={() => {}} onSave={() => {}} onKeep={() => {}} onDiscard={discard} />);
  expect(screen.queryByRole('button', { name: '保留草稿并退出' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '不保存并退出' }));
  expect(discard).toHaveBeenCalledOnce();
});

it('renders the close confirmation above other dialogs with the fallback warning', () => {
  render(<UnsavedWindowDialog targets={[{ scopeKey: 'pdf:test', ownerId: 'test', handler: undefined }]} busy={false} error={null} onEdit={() => {}} onCancel={() => {}} onSave={() => {}} onKeep={() => {}} onDiscard={() => {}} />);
  expect(screen.getByRole('dialog').className).toContain('z-[calc(var(--z-dialog-popover)+1)]');
  expect(screen.getByText(/3 秒内再次点击右上角关闭/)).toBeTruthy();
});
