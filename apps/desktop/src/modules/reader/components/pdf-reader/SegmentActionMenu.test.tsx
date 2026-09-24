/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';
import type { SourceSegment } from '@/shared/types/domain';
import { SegmentBookmarksProvider } from '../SegmentBookmarks';

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

    fireEvent.click(screen.getByRole('menuitem', { name: '编辑片段笔记（浮窗）' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '添加批注或高亮（浮窗）' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '在分屏中打开片段记录' }));

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
    screen.getByRole('menuitem', { name: '编辑片段笔记（浮窗）' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '添加批注或高亮（浮窗）' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '取消收藏位置' }).hasAttribute('disabled')).toBe(false));
  });
});
