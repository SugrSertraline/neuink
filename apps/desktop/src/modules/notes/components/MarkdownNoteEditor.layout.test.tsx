// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import { MarkdownNoteEditor } from './MarkdownNoteEditor';

afterEach(cleanup);

describe('MarkdownNoteEditor responsive layout', () => {
  it.each([false, true])('keeps the scroll owner inside its pane (compact: %s)', async (compact) => {
    const title = 'A long note title must not set the minimum width of the grid column';
    const result = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>
        <MarkdownNoteEditor
          compact={compact}
          entryId="responsive-entry"
          entryTitle="Bridging the Gap between User Intent and LLM: A Requirement Alignment Approach for Code Generation"
          fallbackTitle={title}
          noteId="responsive-note"
          onLoadNote={async () => ({
            note_id: 'responsive-note', title, revision: '1', links: [],
            markdown: '# Responsive note\n\nBody wraps to the pane.\n\n| A | B |\n| --- | --- |\n| One | Two |'
          })}
          onSaveNote={vi.fn()}
        />
      </ToastContext.Provider>
    );
    await waitFor(() => expect(result.getByText('已保存')).toBeTruthy());

    const root = result.container.querySelector<HTMLElement>('.markdown-note-editor')!;
    const content = root.querySelector<HTMLElement>('.tiptap')!;
    const scroll = root.querySelector<HTMLElement>('.markdown-note-scroll')!;

    // CSS grid's implicit auto column uses the header's intrinsic width even
    // when the grid container itself has min-width: 0. Constrain every track.
    for (const grid of [root, ...root.querySelectorAll('.grid')]) {
      expect(grid.classList.contains('grid-cols-1')).toBe(true);
      expect(grid.classList.contains('min-w-0')).toBe(true);
    }
    expect(root.classList.contains('min-h-0')).toBe(true);
    expect(root.classList.contains('min-h-[560px]')).toBe(false);
    expect(root.classList.contains('max-w-full')).toBe(true);
    expect(scroll.contains(content)).toBe(true);
    expect(scroll.classList.contains('w-full')).toBe(true);
    expect(scroll.classList.contains('overflow-y-auto')).toBe(true);
    expect(scroll.classList.contains('overflow-x-hidden')).toBe(true);
    expect(scroll.classList.contains('[scrollbar-gutter:stable]')).toBe(true);
    expect(content.classList.contains('[overflow-wrap:anywhere]')).toBe(true);
    expect(content.querySelector('.tableWrapper table')).toBeTruthy();
    expect(root.querySelectorAll('.overflow-y-auto')).toHaveLength(1);
  });
});
