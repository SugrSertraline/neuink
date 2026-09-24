// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
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

function renderSidebar(props: Partial<ComponentProps<typeof LibrarySidebar>> = {}, notify = vi.fn(() => 'toast')) {
  return render(
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
          onClearFilters={vi.fn()}
          onCreateMarkdownNote={vi.fn()}
          onDeleteMarkdownNote={vi.fn()}
          onOpenContentInRight={vi.fn()}
          onOpenCreateEntryTab={vi.fn()}
          onOpenMarkdownInPdfPane={vi.fn()}
          onOpenTagEditorTab={vi.fn()}
          onRenameMarkdownNote={vi.fn()}
          onRenamePdfDisplayName={vi.fn()}
          onSelectContent={vi.fn()}
          onOpenTagDetails={vi.fn()}
          onSelectView={vi.fn()}
          onUpdateEntry={vi.fn()}
          {...props}
        />
      </TagPreferencesProvider>
    </ToastContext.Provider>
  );
}

describe('LibrarySidebar tag drop', () => {
  it('keeps library navigation visible when a paper is open but details were not selected', () => {
    const view = renderSidebar({ selectedEntry: entry, activeContentId: 'pdf', entryExplorerOpen: false });
    expect(view.getByText('条目库')).toBeTruthy();
    expect(view.getByRole('region', { name: '全部标签' })).toBeTruthy();
    expect(view.queryByText('条目详情')).toBeNull();
    expect(view.queryByRole('button', { name: '返回条目库' })).toBeNull();
  });

  it('shows the entry details header without the obsolete back action', () => {
    const view = renderSidebar({ selectedEntry: entry, activeContentId: 'pdf', entryExplorerOpen: true });
    expect(view.getByText('条目详情')).toBeTruthy();
    expect(view.queryByRole('button', { name: '返回条目库' })).toBeNull();
  });

  it('notifies in the bottom-right toast system after a tag is persisted', async () => {
    const notify = vi.fn(() => 'toast');
    const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
    const view = renderSidebar({ onUpdateEntry }, notify);

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

it('shares resize handles while preserving three independent scroll regions and header actions', () => {
  const onClearFilters = vi.fn();
  const onSelectView = vi.fn();
  const view = renderSidebar({ onClearFilters, onSelectView });
  const panels = ['快速视图', '解析', '全部标签'].map(name => view.getByRole('region', { name }));
  const viewports = panels.map(panel => panel.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!);
  expect(view.container.querySelectorAll('[data-slot="scroll-area-viewport"]')).toHaveLength(3);
  panels.forEach((panel, index) => {
    const height = [100, 125, 200][index];
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: height });
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: height * 1.25 } as DOMRect);
  });
  viewports[2].scrollTop = 80;
  fireEvent.scroll(viewports[2]);
  fireEvent.keyDown(view.getByRole('separator', { name: '调整解析与全部标签高度' }), { key: 'ArrowUp' });
  expect(panels[0].style.flexGrow).toBe('1');
  expect(Number(panels[1].style.flexGrow)).toBeLessThan(1.25);
  expect(Number(panels[2].style.flexGrow)).toBeGreaterThan(2);
  expect(viewports[2].scrollTop).toBe(80);
  fireEvent.click(view.getByRole('button', { name: '显示全部' }));
  expect(onClearFilters).toHaveBeenCalledOnce();
  expect(view.getByRole('button', { name: '快速视图' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(view.getByRole('button', { name: /最近阅读/ }));
  expect(onSelectView).toHaveBeenCalledWith('recent');
  fireEvent.click(view.getByRole('button', { name: '解析' }));
  expect(view.getAllByRole('separator')).toHaveLength(1);
  expect(view.getByRole('separator', { name: '调整快速视图与全部标签高度' })).toBeTruthy();
  expect(within(panels[1]).queryByRole('button', { name: /已解析 PDF/ })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '解析' }));
  expect(view.getAllByRole('separator')).toHaveLength(2);
  expect(panels[1].querySelector('[data-slot="scroll-area-viewport"]')).toBe(viewports[1]);
});

it('keeps tag search, edit and directory navigation independent from the panel collapse', () => {
  const onOpenTagDetails = vi.fn();
  const onOpenTagEditorTab = vi.fn();
  const view = renderSidebar({ onOpenTagDetails, onOpenTagEditorTab, tags: [
    { id: 'research', name: '研究', parent_id: null, created_at: '', updated_at: '' },
    { id: 'code', name: '代码生成', parent_id: 'research', created_at: '', updated_at: '' }
  ] });
  fireEvent.click(view.getByRole('button', { name: '搜索标签' }));
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或路径' }), { target: { value: '代码' } });
  const tagViewport = view.getByRole('region', { name: '全部标签' }).querySelector('[data-slot="scroll-area-viewport"]');
  fireEvent.click(view.getByRole('button', { name: '收起全部标签' }));
  expect(view.queryByRole('textbox', { name: '搜索标签或路径' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '编辑标签' }));
  expect(onOpenTagEditorTab).toHaveBeenCalledOnce();
  expect(view.getByRole('button', { name: '展开全部标签' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '搜索标签' }));
  const search = view.getByRole('textbox', { name: '搜索标签或路径' });
  expect((search as HTMLInputElement).value).toBe('代码');
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(document.activeElement).toBe(view.getByRole('button', { name: '搜索标签' }));
  fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究' }));
  expect(view.getByRole('button', { name: '打开标签 研究/代码生成' }).closest('[data-slot="scroll-area-viewport"]')).toBe(tagViewport);
  fireEvent.click(view.getByRole('button', { name: '上一级' }));
  expect(document.activeElement).toBe(view.getByRole('button', { name: '收起全部标签' }));
  expect(onOpenTagDetails).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '打开标签 研究' }));
  expect(onOpenTagDetails).toHaveBeenCalledWith('research');
});
