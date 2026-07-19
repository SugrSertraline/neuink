// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
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
