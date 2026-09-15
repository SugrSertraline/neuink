// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagPreferencesProvider } from '@/shared/components/TagPreferencesProvider';
import { TAG_PREFERENCES_STORAGE_KEY } from '@/shared/lib/tagPreferences';
import { ToastContext } from '@/shared/hooks/useToast';
import { EntryTagBadges } from '@/modules/reader/components/EntryTagBadges';
import { EntryOverview } from '@/modules/reader/components/EntryOverview';
import { CompactEntryTags } from './EntryMetadataPreviews';
import type { LibraryEntry } from './LibrarySidebar';

const paths = ['研究', '研究/软件工程', '研究/软件工程/代码生成', '待读'];
const entry: LibraryEntry = {
  id: 'paper', title: '论文', tagIds: [], tags: paths, contents: [], fields: {},
  createdAt: '', updatedAt: '', pdfFileName: null, parseMessage: null, parseEndpoint: null, status: 'No PDF', progress: 0
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Surface({ onUpdate = vi.fn() }: { onUpdate?: () => void }) {
  return <TagPreferencesProvider>
    <section aria-label="条目侧栏"><CompactEntryTags tags={paths} /></section>
    <section aria-label="列表标签"><EntryTagBadges tags={paths} /></section>
    <section aria-label="条目概览测试"><ToastContext.Provider value={{ notify: vi.fn(() => 'toast'), dismiss: vi.fn() }}>
      <EntryOverview entry={entry} tags={[]} onUpdateEntry={onUpdate} onOpenContent={vi.fn()} sourceBacklinksBySegmentUid={{}} />
    </ToastContext.Provider></section>
  </TagPreferencesProvider>;
}

describe('shared paper tag display settings', () => {
  it('updates the sidebar, table and overview together without updating saved entry tags', () => {
    const onUpdate = vi.fn();
    const view = render(<Surface onUpdate={onUpdate} />);
    const sidebar = within(view.getByRole('region', { name: '条目侧栏' }));
    const table = within(view.getByRole('region', { name: '列表标签' }));
    const overview = within(view.getByRole('region', { name: '条目概览测试' }));
    expect(sidebar.getByText('代码生成')).toBeTruthy();
    expect(sidebar.queryByText('软件工程')).toBeNull();
    expect(sidebar.getByText('待读')).toBeTruthy();
    expect(sidebar.getByText('已隐藏 2 个上级标签')).toBeTruthy();
    expect(table.getByRole('button', { name: '查看全部 2 个标签' })).toBeTruthy();
    expect(overview.getByText('显示 2 个最具体标签，隐藏 2 个重复上级标签；实际归属不变。')).toBeTruthy();
    fireEvent.keyDown(sidebar.getByRole('button', { name: '论文标签显示设置' }), { key: 'Enter' });
    fireEvent.click(view.getByRole('menuitemcheckbox', { name: '只显示最具体的标签' }));
    expect(sidebar.getByText('软件工程')).toBeTruthy();
    expect(table.getByRole('button', { name: '查看全部 4 个标签' })).toBeTruthy();
    expect(overview.getByText('研究/软件工程')).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(TAG_PREFERENCES_STORAGE_KEY)!).onlyMostSpecificTags).toBe(false);
    expect(paths).toEqual(['研究', '研究/软件工程', '研究/软件工程/代码生成', '待读']);
    expect(onUpdate).not.toHaveBeenCalled();
    view.unmount();
    const reopened = render(<Surface />);
    expect(within(reopened.getByRole('region', { name: '列表标签' })).getByRole('button', { name: '查看全部 4 个标签' })).toBeTruthy();
  });

  it('keeps click access as a fallback and dismisses the preview without opening the entry', () => {
    const onRow = vi.fn();
    const view = render(<TagPreferencesProvider><div onClick={onRow}><EntryTagBadges tags={paths} /></div></TagPreferencesProvider>);
    fireEvent.click(view.getByRole('button', { name: '查看全部 2 个标签' }));
    expect(view.getByRole('tooltip', { name: '条目标签' })).toBeTruthy();
    expect(view.getByText('显示 2 个 · 已隐藏 2 个重复上级标签')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('tooltip')).toBeNull();
    expect(onRow).not.toHaveBeenCalled();
  });

  it('keeps explicit expand/collapse for many tags and qualifies identically named leaves', () => {
    const view = render(<CompactEntryTags tags={['A/同名', 'B/同名', ...Array.from({ length: 10 }, (_, index) => `标签${index}`)]} />);
    expect(view.getByText('A/同名')).toBeTruthy();
    expect(view.getByText('B/同名')).toBeTruthy();
    expect(view.queryByText('标签9')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开全部 12 个标签' }));
    expect(view.getByText('标签9')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '收起标签' }));
    expect(view.queryByText('标签9')).toBeNull();
  });

  it('applies changes in memory and reports persistence failure without mutating a paper', () => {
    const view = render(<Surface />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    const sidebar = within(view.getByRole('region', { name: '条目侧栏' }));
    fireEvent.keyDown(sidebar.getByRole('button', { name: '论文标签显示设置' }), { key: 'Enter' });
    fireEvent.click(view.getByRole('menuitemcheckbox', { name: '只显示最具体的标签' }));
    expect(sidebar.getByText('软件工程')).toBeTruthy();
    fireEvent.keyDown(sidebar.getByRole('button', { name: '论文标签显示设置' }), { key: 'Enter' });
    expect(view.getByRole('alert').textContent).toContain('无法保存');
  });

  it('synchronizes externally changed preferences without rewriting saved settings', () => {
    const view = render(<Surface />);
    window.localStorage.setItem(TAG_PREFERENCES_STORAGE_KEY, JSON.stringify({ onlyMostSpecificTags: false }));
    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: TAG_PREFERENCES_STORAGE_KEY })));
    expect(within(view.getByRole('region', { name: '条目侧栏' })).getByText('软件工程')).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
  });
});
