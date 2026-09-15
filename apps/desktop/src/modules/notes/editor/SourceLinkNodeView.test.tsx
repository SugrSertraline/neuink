// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceLinkNodeView } from './SourceLinkNodeView';
import { NoteSourcesProvider } from '../NoteSourcesContext';
import { inspectNoteSources } from '@/shared/ipc/noteCatalogApi';
import type { SourceLink } from '@/shared/types/domain';
vi.mock('@/shared/ipc/noteCatalogApi', () => ({ inspectNoteSources: vi.fn() }));

vi.mock('@tiptap/react', async () => {
  const React = await import('react');
  return { NodeViewWrapper: React.forwardRef<HTMLElement, React.ComponentProps<'div'> & { as?: React.ElementType }>(
    ({ as: Wrapper = 'div', ...props }, ref) => { const Component = Wrapper; return <Component ref={ref} {...props} />; }
  ) };
});
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({
  SourceSnapshotPreview: ({ markdown, imageDetailEnabled, tableDetailEnabled }: { markdown: string; imageDetailEnabled?: boolean; tableDetailEnabled?: boolean }) => (
    <span data-testid="source-preview" data-image-detail={imageDetailEnabled} data-table-detail={tableDetailEnabled}>{markdown}</span>
  )
}));
function sourceNode(label = '关键结论') {
  return { attrs: { anchorId: 'sl-test-1', displayText: label, expanded: true, page: 3,
    previewAlignment: 'right', previewMode: 'parsed', previewWidth: 24,
    segmentUid: 'segment-7', sourceEntryId: 'entry-2', segmentType: 'paragraph', snapshotText: '这是保存的原文快照。' }
  } as Parameters<typeof SourceLinkNodeView>[0]['node'];
}
function fakeEditor(editable = true) {
  return { isEditable: editable, on: vi.fn(), off: vi.fn(), view: { dom: document.createElement('div') } } as unknown as Editor;
}
beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

describe('SourceLinkNodeView', () => {
  it('shows deleted-paper status, preserves the quote, and re-enables navigation after restoration', async () => {
    const link = { anchor_id: 'sl-test-1', sources: [{ entry_id: 'entry-2', segment_uid: 'segment-7', quote_hash: 'hash' }] } as SourceLink;
    const source = { entry_id: 'entry-2', segment_uid: 'segment-7', quote_hash: 'hash' };
    vi.mocked(inspectNoteSources).mockResolvedValue([{ ...source, status: 'entry_deleted', message: '原论文已删除', can_locate: false }]);
    const onOpenSourceLink = vi.fn();
    const result = render(<NoteSourcesProvider root="root" links={[link]}><SourceLinkNodeView node={sourceNode()} onOpenSourceLink={onOpenSourceLink} /></NoteSourcesProvider>);
    await waitFor(() => expect(result.getByText('原论文已删除')).toBeTruthy());
    fireEvent.click(result.getByRole('button', { name: '预览来源：关键结论' }));
    expect(result.getByTestId('source-preview').textContent).toBe('这是保存的原文快照。');
    expect((result.getByRole('button', { name: '定位原文' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onOpenSourceLink).not.toHaveBeenCalled();
    vi.mocked(inspectNoteSources).mockResolvedValue([{ ...source, status: 'available', message: '原文可用', can_locate: true }]);
    result.rerender(<NoteSourcesProvider root="restored-root" links={[link]}><SourceLinkNodeView node={sourceNode()} onOpenSourceLink={onOpenSourceLink} /></NoteSourcesProvider>);
    await waitFor(() => expect((result.getByRole('button', { name: '定位原文' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(result.getByRole('button', { name: '定位原文' })); expect(onOpenSourceLink).toHaveBeenCalledOnce();
  });
  it('reports its actual pane for keyboard navigation even when another pane was focused', () => {
    const onOpenSourceLink = vi.fn();
    const result = render(<div data-workspace-drop-pane="right"><SourceLinkNodeView node={sourceNode()} onOpenSourceLink={onOpenSourceLink} /></div>);
    fireEvent.click(result.getByRole('button', { name: '关键结论' }));
    expect(onOpenSourceLink).toHaveBeenCalledWith({ originPane: 'right', page: 3, segmentUid: 'segment-7', sourceEntryId: 'entry-2' });
  });

  it('selects the screenshot after image metadata is hydrated', async () => {
    const result = render(<SourceLinkNodeView node={{ attrs: { anchorId: 'sl-image' } }} />);
    result.rerender(<SourceLinkNodeView node={{ attrs: { anchorId: 'sl-image', displayText: '图片', segmentType: 'figure', snapshotAssetPath: 'data:image/png;base64,eA==' } }} />);
    fireEvent.click(result.getByRole('button', { name: '预览来源：图片' }));
    expect(result.getByRole('button', { name: 'PDF 截图' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(result.getByTestId('source-preview')).toBeTruthy());
  });
  it.each([false, true])('locates on a single click, including Ctrl-click (%s), without expanding', (ctrlKey) => {
    const onOpenSourceLink = vi.fn(), updateAttributes = vi.fn();
    const result = render(<SourceLinkNodeView node={sourceNode()} onOpenSourceLink={onOpenSourceLink} updateAttributes={updateAttributes} />);
    const trigger = result.getByRole('button', { name: '关键结论' });
    fireEvent.mouseDown(trigger, { ctrlKey });
    fireEvent.click(trigger, { ctrlKey });
    expect(onOpenSourceLink).toHaveBeenCalledTimes(1);
    expect(onOpenSourceLink).toHaveBeenCalledWith({ page: 3, segmentUid: 'segment-7', sourceEntryId: 'entry-2' });
    expect(result.queryByTestId('source-preview')).toBeNull();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('uses an independent preview trigger and never restores legacy expanded/width state', () => {
    localStorage.setItem('neuink.sourceLinkPreview.sl-test-1', JSON.stringify({ expanded: true, previewWidth: 24 }));
    const updateAttributes = vi.fn();
    const result = render(<SourceLinkNodeView node={sourceNode()} updateAttributes={updateAttributes} />);
    expect(result.queryByTestId('source-preview')).toBeNull();
    fireEvent.click(result.getByRole('button', { name: '预览来源：关键结论' }));
    expect(result.getByTestId('source-preview').dataset).toMatchObject({ imageDetail: 'true', tableDetail: 'true' });
    expect(result.queryByRole('slider')).toBeNull();
    expect(result.getByRole('button', { name: '关闭预览' })).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: 'PDF 截图' }));
    expect(result.getByText('这条引用还没有保存 PDF 截图。')).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: '查看文本摘录' }));
    fireEvent.click(result.getByRole('button', { name: '关闭预览' }));
    expect(result.queryByTestId('source-preview')).toBeNull();
    expect(updateAttributes).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('neuink.sourceLinkPreview.sl-test-1')!)).toEqual({ expanded: true, previewWidth: 24 });
  });

  it('keeps only one transient preview within the same note, even with repeated anchor IDs', () => {
    const result = render(<div className="tiptap">
      <SourceLinkNodeView node={sourceNode('引用一')} />
      <SourceLinkNodeView node={sourceNode('引用二')} />
    </div>);
    fireEvent.click(result.getByRole('button', { name: '预览来源：引用一' }));
    fireEvent.click(result.getByRole('button', { name: '预览来源：引用二' }));
    expect(result.getAllByTestId('source-preview')).toHaveLength(1);
  });

  it('copies the full excerpt, handles failure, and keeps preview open', async () => {
    const result = render(<SourceLinkNodeView node={sourceNode()} />);
    fireEvent.click(result.getByRole('button', { name: '预览来源：关键结论' }));
    fireEvent.click(result.getByRole('button', { name: '复制摘录' }));
    await waitFor(() => expect(result.getByRole('status').textContent).toBe('摘录已复制'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('这是保存的原文快照。');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('blocked'));
    fireEvent.click(result.getByRole('button', { name: '复制摘录' }));
    await waitFor(() => expect(result.getByRole('status').textContent).toContain('复制失败'));
    expect(result.getByTestId('source-preview')).toBeTruthy();
  });

  it.each([false, true])('only permits removing a citation in a writable editor (%s)', async (editable) => {
    const deleteNode = vi.fn();
    const result = render(<SourceLinkNodeView node={sourceNode()} editor={fakeEditor(editable)} deleteNode={deleteNode} />);
    fireEvent.click(result.getByRole('button', { name: '预览来源：关键结论' }));
    fireEvent.keyDown(result.getByRole('button', { name: '更多引用操作' }), { key: 'Enter' });
    const remove = await result.findByRole('menuitem', { name: '移除这条引用' });
    expect(remove.getAttribute('aria-disabled')).toBe(editable ? null : 'true');
    fireEvent.click(remove);
    expect(deleteNode).toHaveBeenCalledTimes(editable ? 1 : 0);
  });

  it('can expand inline and collapse all without editing the note', async () => {
    const updateAttributes = vi.fn();
    const result = render(<div className="tiptap"><SourceLinkNodeView node={sourceNode()} updateAttributes={updateAttributes} /></div>);
    fireEvent.click(result.getByRole('button', { name: '预览来源：关键结论' }));
    fireEvent.keyDown(result.getByRole('button', { name: '更多引用操作' }), { key: 'Enter' });
    fireEvent.click(await result.findByRole('menuitem', { name: '在正文展开' }));
    expect(result.getByRole('button', { name: '收起引用' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(result.getByTestId('source-preview')).toBeTruthy();
    fireEvent.keyDown(result.getByRole('button', { name: '更多引用操作' }), { key: 'Enter' });
    fireEvent.click(await result.findByRole('menuitem', { name: '收起本笔记全部引用' }));
    expect(result.queryByTestId('source-preview')).toBeNull();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it('closes transient preview on Escape and on drag start', async () => {
    const result = render(<SourceLinkNodeView node={sourceNode()} />);
    const trigger = result.getByRole('button', { name: '预览来源：关键结论' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(result.queryByTestId('source-preview')).toBeNull());
    fireEvent.click(trigger);
    fireEvent.dragStart(document.body);
    expect(result.queryByTestId('source-preview')).toBeNull();
  });

  it('shows an empty snapshot and allows page-only source navigation', () => {
    const onOpenSourceLink = vi.fn();
    const node = { attrs: { anchorId: 'sl-empty', page: 4, sourceEntryId: 'entry-2' } };
    const result = render(<SourceLinkNodeView node={node} onOpenSourceLink={onOpenSourceLink} />);
    fireEvent.click(result.getByRole('button', { name: 'p.4' }));
    expect(onOpenSourceLink).toHaveBeenCalledWith({ page: 4, sourceEntryId: 'entry-2', segmentUid: null });
    fireEvent.click(result.getByRole('button', { name: '预览来源：p.4' }));
    expect(result.getByText(/未保存文本摘录/)).toBeTruthy();
    expect((result.getByRole('button', { name: '复制摘录' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
