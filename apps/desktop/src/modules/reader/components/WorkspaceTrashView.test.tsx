// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { WorkspaceTrashView } from './WorkspaceTrashView';

vi.mock('@/modules/library/components/TagArchiveList', () => ({
  TagArchiveList: ({ query }: { query: string }) => <div data-testid="tag-archives">{query}</div>
}));
vi.mock('@/modules/notes/components/TagNotesList', () => ({
  TagNotesList: ({ searchQuery }: { searchQuery: string }) => <div data-testid="tag-notes">{searchQuery}</div>
}));
vi.mock('./TrashItemsView', () => ({
  TrashItemsView: ({ searchQuery }: { searchQuery: string }) => <div data-testid="records">{searchQuery}</div>
}));

afterEach(cleanup);

it('uses one persistent search for all trash categories', () => {
  const view = render(<WorkspaceTrashView root="workspace" tags={[]} items={[]}
    onRestoreTag={vi.fn()} onPurgeEntry={vi.fn()} onPurgeItem={vi.fn()}
    onRestoreEntry={vi.fn()} onRestoreItem={vi.fn()} />);
  expect(view.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.change(view.getByRole('textbox', { name: '搜索回收站' }), { target: { value: '研究' } });
  expect(view.getByTestId('tag-archives').textContent).toBe('研究');
  expect(view.getByTestId('tag-notes').textContent).toBe('研究');
  expect(view.getByTestId('records').textContent).toBe('研究');
  fireEvent.click(view.getByRole('button', { name: '标签笔记' }));
  expect(view.getAllByRole('textbox')).toHaveLength(1);
  expect(view.getByTestId('tag-notes').textContent).toBe('研究');
  fireEvent.click(view.getByRole('button', { name: '条目与记录' }));
  expect(view.getByTestId('records').textContent).toBe('研究');
});
