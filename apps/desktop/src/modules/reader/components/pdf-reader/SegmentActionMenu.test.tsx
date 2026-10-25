/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';
import type { SourceSegment } from '@/shared/types/domain';
import { SegmentBookmarksProvider, SegmentBookmarkButton } from '../SegmentBookmarks';

import { SegmentActionMenu } from './SegmentActionMenu';

const segment: SourceSegment = {
  bbox: [100, 100, 900, 300],
  markdown: 'Source text',
  page_idx: 1,
  segment_type: 'paragraph',
  text: 'Source text',
  uid: 'segment-1'
};
afterEach(cleanup);

describe('SegmentActionMenu', () => {
  it('saves a dirty note before bookmarking it and preserves a failed draft', async () => {
    const saveNote = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const saveBookmark = vi.fn().mockResolvedValue([{ segment_uid:segment.uid,text:'最新想法',bookmarked:true,created_at:'',updated_at:'' }]);
    const view = render(<ToastContext.Provider value={{notify:vi.fn(),dismiss:vi.fn()}}><SegmentBookmarksProvider save={saveBookmark}>
      <SegmentBookmarkButton segment={segment} beforeRemember={saveNote} />
    </SegmentBookmarksProvider></ToastContext.Provider>);
    fireEvent.click(view.getByRole('button',{name:'记住此处'}));
    await waitFor(()=>expect(view.getByRole('button',{name:'记住此处'})).toHaveProperty('disabled',false));
    expect(saveBookmark).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button',{name:'记住此处'}));
    await view.findByRole('button',{name:'取消收藏位置'});
    expect(saveNote).toHaveBeenCalledTimes(2); expect(saveBookmark).toHaveBeenCalledExactlyOnceWith(segment.uid,true);
  });
  it('requires an explicit item choice for a list with no item coordinates', () => {
    const onAddAssistantContext = vi.fn();
    render(<SegmentActionMenu canAddSourceLink={false} canCopyContent canCopySourceLink
      position={{ x: 20, y: 20 }} segment={{ ...segment, segment_type: 'list', markdown: '- Alpha\n- Beta', text: 'Alpha\nBeta' }}
      sourceBacklinks={[]} onClose={vi.fn()} onOpenSegmentAnnotation={vi.fn()} onOpenSegmentNote={vi.fn()}
      onOpenSourceBacklink={vi.fn()} onAddAssistantContext={onAddAssistantContext} />);
    expect(screen.queryByRole('menuitem', { name: '附到助手对话' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '第 2 项' }));
    expect(screen.getByRole('menu', { name: '列表项操作' }).textContent).toContain('仅针对当前列表项');
    fireEvent.click(screen.getByRole('menuitem', { name: '附到助手对话' }));
    expect(onAddAssistantContext).toHaveBeenCalledWith(expect.objectContaining({ text: 'Beta', uid: 'segment-1:list-item:1' }));
  });
  it('separates floating editors from the split segment workspace', () => {
    const onOpenSegmentAnnotation = vi.fn();
    const onOpenSegmentNote = vi.fn();
    const onOpenSegmentWorkspace = vi.fn();
    render(
      <SegmentActionMenu
        canAddSourceLink={false}
        canCopyContent={false}
        canCopySourceLink={false}
        position={{ x: 20, y: 20 }}
        segment={segment}
        sourceBacklinks={[]}
        onClose={vi.fn()}
        onOpenSegmentAnnotation={onOpenSegmentAnnotation}
        onOpenSegmentNote={onOpenSegmentNote}
        onOpenSegmentWorkspace={onOpenSegmentWorkspace}
        onOpenSourceBacklink={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('menuitem', { name: '为此处写笔记' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '添加批注' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '在另一分栏查看片段记录' }));

    expect(onOpenSegmentNote).toHaveBeenCalledWith(segment);
    expect(onOpenSegmentAnnotation).toHaveBeenCalledWith(segment);
    expect(onOpenSegmentWorkspace).toHaveBeenCalledWith(segment);
  });

  it('navigates to the bookmark item, saves once, and skips it while saving', async () => {
    const save = vi.fn().mockResolvedValue([{ segment_uid: segment.uid, text: '', bookmarked: true, created_at: '', updated_at: '' }]);
    const onClose = vi.fn();
    const onOuterClick = vi.fn();
    render(<ToastContext.Provider value={{ notify: () => '', dismiss: vi.fn() }}>
      <SegmentBookmarksProvider save={save}><div onClick={onOuterClick}>
        <SegmentActionMenu canAddSourceLink={false} canCopyContent={false} canCopySourceLink={false}
          position={{ x: 20, y: 20 }} segment={segment} sourceBacklinks={[]}
          onClose={onClose} onOpenSegmentAnnotation={vi.fn()} onOpenSegmentNote={vi.fn()} onOpenSourceBacklink={vi.fn()} />
      </div></SegmentBookmarksProvider>
    </ToastContext.Provider>);
    const bookmark = screen.getByRole('menuitem', { name: '记住此处' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(bookmark);
    fireEvent.click(bookmark);
    expect(bookmark.hasAttribute('disabled')).toBe(true);
    fireEvent.click(bookmark);
    expect(save).toHaveBeenCalledExactlyOnceWith(segment.uid, true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOuterClick).not.toHaveBeenCalled();
    screen.getByRole('menuitem', { name: '为此处写笔记' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '添加批注' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '取消收藏位置' }).hasAttribute('disabled')).toBe(false));
  });
});
