// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TagPreferencesProvider } from '@/shared/components/TagPreferencesProvider';
import { ToastContext } from '@/shared/hooks/useToast';
import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag } from '@/shared/lib/entryDragData';

import { LibrarySidebar, type LibraryEntry } from './LibrarySidebar';

const entry: LibraryEntry = {
  id: 'paper-1',
  contents: [],
  title: '可视分析论文',
  tagIds: [],
  tags: [],
  fields: {},
  createdAt: '',
  updatedAt: '',
  pdfFileName: 'paper.pdf',
  parseMessage: null,
  parseEndpoint: null,
  status: 'Parsed',
  progress: 100
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  cancelEntryTagDrag();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LibrarySidebar tag drop', () => {
  it('notifies in the bottom-right toast system after a tag is persisted', async () => {
    const notify = vi.fn(() => 'toast');
    const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify }}>
        <TagPreferencesProvider>
          <LibrarySidebar
            activeContentId={null}
            activeTag={null}
            activeView="all"
            entries={[entry]}
            entryExplorerOpen={false}
            error={null}
            recentReadingEntryIds={[]}
            selectedEntry={null}
            status="ready"
            tags={[{ id: 'research', name: '研究', parent_id: null, created_at: '', updated_at: '' }]}
            trashItemCount={0}
            onAttachPdf={vi.fn()}
            onBackToLibraryExplorer={vi.fn()}
            onClearFilters={vi.fn()}
            onCreateMarkdownNote={vi.fn()}
            onCreatePdfVersion={vi.fn()}
            onDeleteMarkdownNote={vi.fn()}
            onImportMineruClientResult={vi.fn()}
            onOpenContentInRight={vi.fn()}
            onOpenCreateEntryTab={vi.fn()}
            onOpenMarkdownInPdfPane={vi.fn()}
            onOpenTagEditorTab={vi.fn()}
            onRenameMarkdownNote={vi.fn()}
            onRenamePdfDisplayName={vi.fn()}
            onSelectContent={vi.fn()}
            onOpenTagDetails={vi.fn()}
            onSelectView={vi.fn()}
            onUpdateEntry={onUpdateEntry}
          />
        </TagPreferencesProvider>
      </ToastContext.Provider>
    );

    const row = view.getByRole('button', { name: '打开标签 研究' }).parentElement!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 210, top: 10, bottom: 40 } as DOMRect);

    act(() => beginEntryTagDrag(entry.id, 20, 20));
    act(() => finishEntryTagDrag(20, 20));

    await waitFor(() => expect(onUpdateEntry).toHaveBeenCalledWith(entry.id, {
      fields: entry.fields,
      tagPaths: ['研究'],
      title: entry.title
    }));
    expect(notify).toHaveBeenCalledWith({
      tone: 'success',
      title: '标签已添加',
      description: '已将“可视分析论文”添加到“研究”。'
    });
  });
});
