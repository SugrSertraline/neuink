// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import { MarkdownNoteEditor } from './MarkdownNoteEditor';

afterEach(cleanup);

describe('MarkdownNoteEditor dirty state', () => {
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
            title: 'Remote article'
          })}
          onSaveNote={async (title, markdown) => ({
            links: [],
            markdown,
            note_id: 'note-1',
            title
          })}
        />
      </ToastContext.Provider>
    );

    await waitFor(() => {
      expect(result.getByText(/自动保存已关闭/)).toBeTruthy();
    });
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    expect(result.queryByText('未保存，请手动保存')).toBeNull();
  });
});
