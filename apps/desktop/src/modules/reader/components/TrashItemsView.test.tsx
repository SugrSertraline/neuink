// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TrashItem } from '@/shared/types/domain';
import { TrashItemsView } from './TrashItemsView';

afterEach(cleanup);

describe('TrashItemsView', () => {
  it('shows deleted child content together with its original entry', () => {
    const items: TrashItem[] = [
      {
        trash_id: 'markdown_note:n1',
        entry_id: 'entry-1',
        entry_title: '论文 A',
        kind: 'markdown_note',
        item_id: 'n1',
        title: '实验记录',
        preview: '删除前的 Markdown 内容摘要',
        deleted_at: '2026-07-19T12:00:00Z',
        parent_entry_trashed: false,
        restorable: true,
        stored_trash_item: true
      }
    ];

    const { getByText } = render(
      <TrashItemsView
        items={items}
        onPurgeEntry={vi.fn()}
        onPurgeItem={vi.fn()}
        onRestoreEntry={vi.fn()}
        onRestoreItem={vi.fn()}
      />
    );

    expect(getByText('Markdown 笔记')).toBeTruthy();
    expect(getByText('实验记录')).toBeTruthy();
    expect(getByText('论文 A')).toBeTruthy();
    expect(getByText('删除前的 Markdown 内容摘要')).toBeTruthy();
  });
});

it('uses the shared trash search when supplied without rendering a second input', () => {
  const item: TrashItem = {
    trash_id: 'markdown_note:n1', entry_id: 'entry-1', entry_title: '论文 A',
    kind: 'markdown_note', item_id: 'n1', title: '实验记录', preview: '摘要',
    deleted_at: '2026-07-19T12:00:00Z', parent_entry_trashed: false,
    restorable: true, stored_trash_item: true
  };
  const props = { items: [item], onPurgeEntry: vi.fn(), onPurgeItem: vi.fn(), onRestoreEntry: vi.fn(), onRestoreItem: vi.fn() };
  const view = render(<TrashItemsView {...props} searchQuery="无匹配" />);
  expect(view.queryByRole('textbox')).toBeNull();
  expect(view.queryByText('实验记录')).toBeNull();
  view.rerender(<TrashItemsView {...props} searchQuery="论文 A" />);
  expect(view.getByText('实验记录')).toBeTruthy();
});

it('confirms permanent record deletion and keeps the dialog open on failure', async () => {
  const item: TrashItem = {
    trash_id: 'markdown_note:n1', entry_id: 'entry-1', entry_title: '论文 A',
    kind: 'markdown_note', item_id: 'n1', title: '实验记录', preview: '摘要',
    deleted_at: '2026-07-19T12:00:00Z', parent_entry_trashed: false,
    restorable: true, stored_trash_item: true,
  };
  const purge = vi.fn().mockRejectedValue(new Error('删除失败'));
  const view = render(<TrashItemsView items={[item]} onPurgeEntry={vi.fn()} onPurgeItem={purge} onRestoreEntry={vi.fn()} onRestoreItem={vi.fn()} />);
  fireEvent.click(view.getByRole('button', { name: '彻底删除 实验记录' }));
  expect(purge).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '彻底删除' }));
  await waitFor(() => expect(view.getByRole('dialog').textContent).toContain('删除失败'));
  expect(purge).toHaveBeenCalledWith('entry-1', 'markdown_note:n1');
});
