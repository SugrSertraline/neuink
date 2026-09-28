// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
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
  const view = render(<ToastContext.Provider value={{ dismiss: noop, notify: () => 'toast' }}><TagPreferencesProvider><EntryContentSidebar entry={entry} tags={[]} activeContentId="overview"
    onOpenTrash={onOpenTrash} onCreateMarkdownNote={noop} onDeleteMarkdownNote={noop} onAttachPdf={noop}
    onOpenMarkdownInPdfPane={noop} onOpenContentInRight={noop} onRenameMarkdownNote={noop}
    onRenamePdfDisplayName={noop} onSelectContent={onSelectContent} /></TagPreferencesProvider></ToastContext.Provider>);
  fireEvent.click(view.getByRole('button', { name: '文档笔记 · 1' }));
  expect(view.queryByRole('button', { name: '阅读小结 文档笔记' })).toBeNull();
  expect(view.getByRole('button', { name: '新建文档笔记' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '文档笔记 · 1' }));
  fireEvent.click(view.getByRole('button', { name: '阅读小结 文档笔记' }));
  expect(onSelectContent).toHaveBeenCalledWith('note:note');
  fireEvent.click(view.getByRole('button', { name: '回收站 条目、笔记与标签' }));
  expect(onOpenTrash).toHaveBeenCalledOnce();
  expect(onSelectContent).not.toHaveBeenCalledWith('entry-trash');
  expect(view.queryByRole('button', { name: '编辑条目' })).toBeNull();
  expect(view.queryByRole('button', { name: '创建新版 PDF' })).toBeNull();
});

it('opens a full-width note rename editor with explicit save and cancel actions', async () => {
  const onRenameMarkdownNote = vi.fn().mockRejectedValueOnce(new Error('标题已被其他窗口修改')).mockResolvedValue(undefined);
  const onSelectContent = vi.fn();
  const view = render(<ToastContext.Provider value={{ dismiss: noop, notify: () => 'toast' }}><TagPreferencesProvider><EntryContentSidebar entry={entry} tags={[]} activeContentId="overview"
    onOpenTrash={noop} onCreateMarkdownNote={noop} onDeleteMarkdownNote={noop} onAttachPdf={noop}
    onOpenMarkdownInPdfPane={noop} onOpenContentInRight={noop} onRenameMarkdownNote={onRenameMarkdownNote}
    onRenamePdfDisplayName={noop} onSelectContent={onSelectContent} /></TagPreferencesProvider></ToastContext.Provider>);
  fireEvent.contextMenu(view.getByRole('button', { name: '阅读小结 文档笔记' }));
  fireEvent.click(view.getByRole('button', { name: '修改标题' }));
  const editor = view.getByRole('group', { name: '修改笔记标题' });
  const input = within(editor).getByRole('textbox', { name: '修改笔记标题' });
  expect(document.activeElement).toBe(input);
  expect(view.queryByRole('button', { name: '阅读小结 文档笔记' })).toBeNull();
  fireEvent.change(input, { target: { value: '新的阅读小结' } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  expect(await within(editor).findByRole('alert')).toHaveProperty('textContent', '标题已被其他窗口修改');
  expect((input as HTMLInputElement).value).toBe('新的阅读小结');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(onRenameMarkdownNote).toHaveBeenCalledTimes(2));
  expect(onRenameMarkdownNote).toHaveBeenLastCalledWith('entry', 'note', '新的阅读小结');
  await waitFor(() => expect(view.queryByRole('group', { name: '修改笔记标题' })).toBeNull());
  expect(onSelectContent).not.toHaveBeenCalled();
});

it('keeps PDF rename validation inline and cancels with Escape', () => {
  const onRenamePdfDisplayName = vi.fn();
  const view = render(<ToastContext.Provider value={{ dismiss: noop, notify: () => 'toast' }}><TagPreferencesProvider><EntryContentSidebar
    entry={{ ...entry, pdfFileName: 'paper.pdf', status: 'Queued' }} tags={[]} activeContentId="overview"
    onOpenTrash={noop} onCreateMarkdownNote={noop} onDeleteMarkdownNote={noop} onAttachPdf={noop}
    onOpenMarkdownInPdfPane={noop} onOpenContentInRight={noop} onRenameMarkdownNote={noop}
    onRenamePdfDisplayName={onRenamePdfDisplayName} onSelectContent={noop} /></TagPreferencesProvider></ToastContext.Provider>);
  fireEvent.contextMenu(view.getByRole('button', { name: 'paper.pdf PDF' }));
  fireEvent.click(view.getByRole('button', { name: '修改文件名' }));
  const editor = view.getByRole('group', { name: '修改 PDF 文件名' });
  const input = within(editor).getByRole('textbox', { name: '修改 PDF 文件名' });
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
  expect(within(editor).getByRole('alert').textContent).toBe('文件名不能为空。');
  expect(onRenamePdfDisplayName).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(view.queryByRole('group', { name: '修改 PDF 文件名' })).toBeNull();
  expect(view.getByRole('button', { name: 'paper.pdf PDF' })).toBeTruthy();
});
