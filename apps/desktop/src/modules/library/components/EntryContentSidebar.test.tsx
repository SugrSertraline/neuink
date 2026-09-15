// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagPreferencesProvider } from '@/shared/components/TagPreferencesProvider';
import { ToastContext } from '@/shared/hooks/useToast';
import { EntryContentSidebar } from './EntryContentSidebar';
import type { LibraryEntry } from './LibrarySidebar';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const noop = () => undefined;
const entry: LibraryEntry = { id: 'entry', title: '论文', contents: [{ kind: 'note', title: '阅读小结', note_id: 'note' }], tags: [], tagIds: [], fields: {},
  pdfFileName: null, createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null, progress: 0, status: 'No PDF' };

it('collapses document notes without hiding the create action and opens the unified trash', () => {
  const onOpenTrash = vi.fn();
  const onSelectContent = vi.fn();
  const view = render(<ToastContext.Provider value={{ dismiss: noop, notify: () => 'toast' }}><TagPreferencesProvider><EntryContentSidebar entry={entry} tags={[]} activeContentId="overview" onBack={noop}
    onOpenTrash={onOpenTrash} onCreateMarkdownNote={noop} onDeleteMarkdownNote={noop} onAttachPdf={noop} onCreatePdfVersion={noop}
    onImportMineruClientResult={noop} onOpenMarkdownInPdfPane={noop} onOpenContentInRight={noop} onRenameMarkdownNote={noop}
    onRenamePdfDisplayName={noop} onSelectContent={onSelectContent} onUpdateEntry={noop} /></TagPreferencesProvider></ToastContext.Provider>);
  fireEvent.click(view.getByRole('button', { name: '文档笔记 · 1' }));
  expect(view.queryByRole('button', { name: '阅读小结 文档笔记' })).toBeNull();
  expect(view.getByRole('button', { name: '新建文档笔记' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '文档笔记 · 1' }));
  fireEvent.click(view.getByRole('button', { name: '阅读小结 文档笔记' }));
  expect(onSelectContent).toHaveBeenCalledWith('note:note');
  fireEvent.click(view.getByRole('button', { name: '回收站 条目、笔记与标签' }));
  expect(onOpenTrash).toHaveBeenCalledOnce();
  expect(onSelectContent).not.toHaveBeenCalledWith('entry-trash');
});
