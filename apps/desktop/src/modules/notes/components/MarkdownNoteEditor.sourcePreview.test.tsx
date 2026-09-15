// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import type { NoteDocument } from '@/shared/types/domain';
import { MarkdownNoteEditor } from './MarkdownNoteEditor';

afterEach(cleanup);
describe('MarkdownNoteEditor source previews', () => {
  it('does not dirty or save the real editor while viewing or switching citation previews', async () => {
    const note: NoteDocument = { note_id: 'source-preview-test', title: '来源交互', revision: 'initial',
      markdown: '阅读结论 [^sl-source]\n',
      links: [{ link_id: 'link', anchor_id: 'sl-source', display_text: 'p.3', created_at: '', owner: { kind: 'note', entry_id: 'source-test', note_id: 'source-preview-test' },
        sources: [{ entry_id: 'source-test', segment_uid: 'seg', page: 3, segment_type: 'paragraph', snapshot_text: '原文内容', quote_hash: '' }] }] };
    const onSaveNote = vi.fn(async () => note);
    const result = render(<ToastContext.Provider value={{ notify: vi.fn(() => ''), dismiss: vi.fn() }}>
      <MarkdownNoteEditor entryId="source-test" noteId={note.note_id} fallbackTitle={note.title}
        onLoadNote={async () => note} onSaveNote={onSaveNote} onOpenSourceLink={vi.fn()} />
    </ToastContext.Provider>);
    const trigger = await result.findByRole('button', { name: '预览来源：p.3' });
    fireEvent.click(trigger);
    expect(result.getByText('原文内容')).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'PDF 截图' }));
    fireEvent.click(result.getByRole('button', { name: '文本摘录' }));
    fireEvent.keyDown(result.getByRole('button', { name: '更多引用操作' }), { key: 'Enter' });
    fireEvent.click(await result.findByRole('menuitem', { name: '在正文展开' }));
    fireEvent.click(result.getByRole('button', { name: '收起引用' }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onSaveNote).not.toHaveBeenCalled();
  });
});
