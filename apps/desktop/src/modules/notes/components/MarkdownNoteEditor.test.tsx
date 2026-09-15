// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import { MarkdownNoteEditor } from './MarkdownNoteEditor';
import { discardSegmentEditorsBeforeClose, hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';

afterEach(cleanup);

describe('MarkdownNoteEditor dirty state', () => {
  it('includes embedded note drafts in parent close protection and truly discards a failed draft', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk unavailable'));
    const result = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}><MarkdownNoteEditor
      entryId="tag-reading:scope-test" noteOwner={{ kind: 'tag_reading', tag_id: 'scope-test' }} noteId="embedded"
      editorScopeKey="tag-reading:scope-test/note:embedded" fallbackTitle="Saved title"
      onLoadNote={async () => ({ note_id: 'embedded', title: 'Saved title', markdown: 'Saved body', links: [], revision: 'base' })}
      onSaveNote={save} /></ToastContext.Provider>);
    await waitFor(() => expect(result.getByText(/自动保存/)).toBeTruthy());
    fireEvent.click(result.getByRole('button', { name: 'Saved title' }));
    fireEvent.change(result.getByRole('textbox', { name: '文档笔记标题' }), { target: { value: 'Unsaved title' } });
    expect(hasUnsavedSegmentEditors('tag-reading:scope-test')).toBe(true);
    await act(async () => { expect(await saveSegmentEditorsBeforeClose('tag-reading:scope-test')).toBe(false); });
    expect(hasUnsavedSegmentEditors('tag-reading:scope-test')).toBe(true);
    act(() => discardSegmentEditorsBeforeClose('tag-reading:scope-test'));
    expect(hasUnsavedSegmentEditors('tag-reading:scope-test')).toBe(false);
    expect(result.getByRole('button', { name: 'Saved title' })).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('reports a second view as read-only and never grants it an insertion target', async () => {
    const writableA = vi.fn(), writableB = vi.fn();
    const props = { entryId: 'shared-parallel', noteId: 'shared', fallbackTitle: 'Shared',
      onLoadNote: async () => ({ note_id: 'shared', title: 'Shared', markdown: 'Body', links: [], revision: '1' }), onSaveNote: vi.fn() };
    const result = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}><MarkdownNoteEditor {...props} onWritableChange={writableA} /><MarkdownNoteEditor {...props} editorScopeKey="tag-reading:other/note:shared" onWritableChange={writableB} /></ToastContext.Provider>);
    await waitFor(() => expect(writableA).toHaveBeenLastCalledWith(true));
    expect(writableB).not.toHaveBeenCalledWith(true);
    expect(result.container.querySelectorAll('.tiptap[contenteditable="true"]')).toHaveLength(1);
    expect(hasUnsavedSegmentEditors('tag-reading:other')).toBe(false);
  });
  it('does not mark a freshly loaded normalized Markdown document as unsaved', async () => {
    const result = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-1') }}>
        <MarkdownNoteEditor
          entryId="entry-1"
          fallbackTitle="Remote article"
          noteId="note-1"
          onLoadNote={async () => ({
            links: [],
            markdown: '# Remote article\n\n- first item\n- second item\n\nParagraph.\n',
            note_id: 'note-1',
            revision: 'revision-1',
            title: 'Remote article'
          })}
          onSaveNote={async (title, markdown) => ({
            links: [],
            markdown,
            note_id: 'note-1',
            revision: 'revision-2',
            title
          })}
        />
      </ToastContext.Provider>
    );

    await waitFor(() => {
      expect(result.getByText(/自动保存/)).toBeTruthy();
    });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(result.queryByText('未保存，请手动保存')).toBeNull();
  });

  it('saves only the editor that contains keyboard focus', async () => {
    const firstSave = vi.fn(async (title: string, markdown: string) => ({
      links: [], markdown, note_id: 'note-first', revision: 'revision-first-2', title
    }));
    const secondSave = vi.fn(async (title: string, markdown: string) => ({
      links: [], markdown, note_id: 'note-second', revision: 'revision-second-2', title
    }));
    const result = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-1') }}>
        <div>
          <MarkdownNoteEditor
            entryId="entry-shortcut"
            fallbackTitle="First"
            noteId="note-first"
            onLoadNote={async () => ({ links: [], markdown: 'First', note_id: 'note-first', revision: 'revision-first-1', title: 'First' })}
            onSaveNote={firstSave}
          />
          <MarkdownNoteEditor
            entryId="entry-shortcut"
            fallbackTitle="Second"
            noteId="note-second"
            onLoadNote={async () => ({ links: [], markdown: 'Second', note_id: 'note-second', revision: 'revision-second-1', title: 'Second' })}
            onSaveNote={secondSave}
          />
        </div>
      </ToastContext.Provider>
    );

    await waitFor(() => expect(result.getAllByText(/自动保存/)).toHaveLength(2));
    const editors = result.container.querySelectorAll<HTMLElement>('.tiptap');
    expect(editors).toHaveLength(2);
    fireEvent.keyDown(editors[0]!, { ctrlKey: true, key: 's' });

    await waitFor(() => expect(firstSave).toHaveBeenCalledTimes(1));
    expect(secondSave).not.toHaveBeenCalled();
  });

  it('keeps a failed load read-only until the user retries', async () => {
    const result = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-1') }}>
        <MarkdownNoteEditor
          entryId="entry-load-error"
          fallbackTitle="Unavailable"
          noteId="note-load-error"
          onLoadNote={async () => { throw new Error('无法读取笔记'); }}
          onSaveNote={vi.fn()}
        />
      </ToastContext.Provider>
    );

    await waitFor(() => expect(result.getByText('重新加载')).toBeTruthy());
    expect(result.container.querySelector('.tiptap')?.getAttribute('contenteditable')).toBe('false');
    expect(result.getByTitle('保存（Ctrl/Cmd + S）')).toHaveProperty('disabled', true);
  });

  it('sends the loaded revision when saving and explains stale-write conflicts', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({
        links: [],
        markdown: 'Current body',
        note_id: 'note-conflict',
        revision: 'revision-before-edit',
        title: 'Conflict note'
      })
      .mockResolvedValue({
        links: [],
        markdown: 'Changed on disk',
        note_id: 'note-conflict',
        revision: 'revision-from-disk',
        title: 'Disk title'
      });
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('note changed after it was opened: note-conflict'))
      .mockImplementation(async (title: string, markdown: string) => ({
        links: [],
        markdown,
        note_id: 'note-conflict',
        revision: 'revision-after-overwrite',
        title
      }));
    const result = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-1') }}>
        <MarkdownNoteEditor
          entryId="entry-conflict"
          fallbackTitle="Conflict note"
          noteId="note-conflict"
          onLoadNote={load}
          onSaveNote={save}
        />
      </ToastContext.Provider>
    );

    await waitFor(() => expect(result.getByText(/自动保存/)).toBeTruthy());
    const editor = result.container.querySelector<HTMLElement>('.tiptap');
    expect(editor).toBeTruthy();
    fireEvent.keyDown(editor!, { ctrlKey: true, key: 's' });

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        'Conflict note',
        expect.any(String),
        [],
        'revision-before-edit'
      );
      expect(
        result.getByTitle(
          '笔记已在其他位置被修改。当前草稿仍保留，请先通过“文件操作 → 另存为”备份，再重新打开笔记处理冲突。'
        )
      ).toBeTruthy();
      expect(result.getByText('版本冲突')).toBeTruthy();
      expect(result.getByLabelText('笔记版本冲突')).toBeTruthy();
      expect(result.getByText('检测到磁盘上的新版本')).toBeTruthy();
    });

    fireEvent.click(result.getByText('比较两版内容'));
    expect(result.getByText('Changed on disk')).toBeTruthy();
    expect(result.getAllByText('Current body')).toHaveLength(2);

    fireEvent.click(result.getByRole('button', { name: /用当前草稿覆盖/ }));
    await waitFor(() => {
      expect(save).toHaveBeenLastCalledWith(
        'Conflict note',
        expect.any(String),
        [],
        'revision-from-disk'
      );
      expect(result.queryByLabelText('笔记版本冲突')).toBeNull();
      expect(result.getByText('已保存')).toBeTruthy();
    });
  });
});
