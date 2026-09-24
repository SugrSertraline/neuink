// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import type { SegmentBlockNote, SourceSegment } from '@/shared/types/domain';
import { SegmentBookmarkButton, SegmentBookmarksProvider, usePublishSegmentNotes } from '../SegmentBookmarks';
import { ReadingNavigationScope, useReadingNavigation } from './ReadingNavigation';
import { ReadingNavigationControls } from './ReadingNavigationControls';
const segment: SourceSegment = {uid:'s',text:'Original source',markdown:null,bbox:null,page_idx:2,segment_type:'paragraph'};
const notes: SegmentBlockNote[] = [{segment_uid:'s',text:'',bookmarked:true,created_at:'',updated_at:''}];
beforeEach(() => {
  // Side previews need a real clipping viewport; jsdom otherwise reports detached anchors.
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 240, 48));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Harness({ records = notes, source = [segment], navigate = () => true }: {
  records?: SegmentBlockNote[]; source?: SourceSegment[]; navigate?: () => boolean;
}) {
  usePublishSegmentNotes(records);
  const nav=useReadingNavigation()!;
  useEffect(() => nav.register({capture:()=>({pageIdx:0,offset:0,left:0}),restore:vi.fn(),navigate}),[nav.register, navigate]);
  return <><ReadingNavigationControls segments={source} entryId="e" workspaceRoot={null}/><SegmentBookmarkButton segment={segment}/></>;
}
describe('notes as bookmarks', () => {
  it('returns from a bookmark through visible history controls and can go forward again', async () => {
    const navigate = vi.fn(() => true);
    render(<ToastContext.Provider value={{dismiss:vi.fn(),notify:()=>''}}><SegmentBookmarksProvider save={vi.fn()}><ReadingNavigationScope><Harness navigate={navigate}/></ReadingNavigationScope></SegmentBookmarksProvider></ToastContext.Provider>);
    expect(screen.getByRole('button', { name: '返回阅读位置' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('笔记定位'));
    fireEvent.click(await screen.findByRole('button', { name: '定位第 3 页的收藏' }));
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '返回阅读位置' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '返回阅读位置' }));
    expect(screen.getByRole('button', { name: '前进阅读位置' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '前进阅读位置' }));
    expect(screen.getByRole('button', { name: '返回阅读位置' }).hasAttribute('disabled')).toBe(false);
  });
  it('shows an empty bookmarked note in the existing notes locator and unmarks without replacing text', async () => {
    const save=vi.fn().mockResolvedValue([{...notes[0],bookmarked:false}]);
    render(<ToastContext.Provider value={{dismiss:vi.fn(),notify:()=>''}}><SegmentBookmarksProvider save={save}><ReadingNavigationScope><Harness/></ReadingNavigationScope></SegmentBookmarksProvider></ToastContext.Provider>);
    fireEvent.click(screen.getByLabelText('笔记定位'));
    expect(await screen.findByText('第 3 页 · 收藏')).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText('取消收藏位置')[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith('s',false));
    await waitFor(() => expect(screen.queryByText('第 3 页 · 收藏')).toBeNull());
  });
  it('retains the saved marker after write failure and offers retry', async () => {
    const notify=vi.fn().mockReturnValue(''); const save=vi.fn().mockRejectedValue(new Error('disk unavailable'));
    render(<ToastContext.Provider value={{dismiss:vi.fn(),notify}}><SegmentBookmarksProvider save={save}><ReadingNavigationScope><Harness/></ReadingNavigationScope></SegmentBookmarksProvider></ToastContext.Provider>);
    fireEvent.click(screen.getByLabelText('取消收藏位置'));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(screen.getByLabelText('取消收藏位置').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByLabelText('取消收藏位置')); await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
  });
});

describe('bounded note previews', () => {
  function setup({ missing = false, empty = false, navigate = vi.fn(() => true) } = {}) {
    const records = [{ ...notes[0], text: empty ? '' : '很长的阅读笔记。'.repeat(200) + '笔记末尾' }];
    render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => '' }}><SegmentBookmarksProvider save={vi.fn()}><ReadingNavigationScope>
      <Harness records={records} source={missing ? [] : [{ ...segment, text: 'Original paragraph. '.repeat(200) + 'Source end' }]} navigate={navigate} />
    </ReadingNavigationScope></SegmentBookmarksProvider></ToastContext.Provider>);
    fireEvent.click(screen.getByLabelText('笔记定位'));
    return { navigate };
  }
  it('opens the complete note explicitly and switches to the source without navigating', async () => {
    const { navigate } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '预览第 3 页的笔记与原文' }));
    const body = await screen.findByRole('region', { name: '笔记预览正文' });
    expect(body.textContent).toContain('笔记末尾');
    await waitFor(() => expect(document.activeElement).toBe(body));
    expect(screen.queryByRole('region', { name: '对应原文预览正文' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '对应原文' }));
    expect((await screen.findByRole('region', { name: '对应原文预览正文' })).textContent).toContain('Source end');
    expect(screen.queryByRole('region', { name: '笔记预览正文' })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('keeps the preview while scrolling and returns focus on Escape without closing the locator', async () => {
    setup();
    const trigger = await screen.findByRole('button', { name: '预览第 3 页的笔记与原文' });
    fireEvent.click(trigger);
    const body = await screen.findByRole('region', { name: '笔记预览正文' });
    fireEvent.scroll(body);
    expect(screen.getByRole('region', { name: '笔记预览正文' })).toBe(body);
    fireEvent.keyDown(body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: '笔记预览正文' })).toBeNull());
    expect(screen.getByLabelText('搜索笔记位置')).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });
  it('provides a stable source action that navigates only once', async () => {
    const { navigate } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '预览第 3 页的笔记与原文' }));
    fireEvent.click(await screen.findByRole('button', { name: '定位原文' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText('搜索笔记位置')).toBeNull());
  });
  it('keeps a missing source note readable and disables source navigation', async () => {
    setup({ missing: true });
    fireEvent.click(await screen.findByRole('button', { name: '预览失效位置的笔记' }));
    expect((await screen.findByRole('region', { name: '笔记预览正文' })).textContent).toContain('笔记末尾');
    fireEvent.click(screen.getByRole('button', { name: '对应原文' }));
    expect(screen.getByText('原文段落已不存在，笔记内容仍保留。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '定位原文' }).hasAttribute('disabled')).toBe(true);
  });
  it('shows the original directly for an empty bookmark and supports ArrowRight access', async () => {
    setup({ empty: true });
    fireEvent.keyDown(await screen.findByRole('button', { name: '定位第 3 页的收藏' }), { key: 'ArrowRight' });
    const body = await screen.findByRole('region', { name: '对应原文预览正文' });
    expect(within(body).getByText(/Source end/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '笔记' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(body));
  });
});
