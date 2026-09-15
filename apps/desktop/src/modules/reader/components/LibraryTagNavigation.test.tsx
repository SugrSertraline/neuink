// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag } from '@/shared/lib/entryDragData';
import type { TagNode } from '../../library/utils/tagTree';
import { LibraryTagNavigation, LibraryTagNavigationItem } from './LibraryTagNavigation';

const node: TagNode = { id: 'topic', name: '空主题', path: '研究/空主题', parentId: 'research', children: [], count: 0, depth: 1 };
afterEach(() => { cleanup(); cancelEntryTagDrag(); vi.restoreAllMocks(); });

describe('LibraryTagNavigationItem', () => {
  it('limits navigation to two rows, expands the rest and removes hidden drop targets when collapsed', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({ ...node, id: `tag-${i}`, name: `标签 ${i}`, path: `标签 ${i}` }));
    const assign = vi.fn();
    const view = render(<LibraryTagNavigation nodes={nodes} nested={false} onOpen={vi.fn()} onAssignEntryToTag={assign} />);
    const list = view.getByRole('list');
    Object.defineProperty(list, 'clientWidth', { configurable: true, value: 420 });
    fireEvent(window, new Event('resize'));
    expect(view.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(view.getByRole('button', { name: '展开全部 20 个标签' }));
    expect(view.getAllByRole('listitem')).toHaveLength(20);
    const last = view.getByRole('button', { name: '打开标签 标签 19' });
    vi.spyOn(last, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 100, top: 200, bottom: 232 } as DOMRect);
    fireEvent.click(view.getByRole('button', { name: '收起' }));
    expect(view.queryByRole('button', { name: '打开标签 标签 19' })).toBeNull();
    act(() => { beginEntryTagDrag('paper', 50, 210); finishEntryTagDrag(50, 210); });
    expect(assign).not.toHaveBeenCalled();
  });

  it('enters a tag with one click or keyboard activation, including a tag without children or papers', () => {
    const onOpen = vi.fn();
    const view = render(<LibraryTagNavigationItem node={node} onOpen={onOpen} onAssignEntryToTag={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: '打开标签 研究/空主题' }), { detail: 1 });
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(view.getByRole('button', { name: '打开标签 研究/空主题' }), { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('0 篇论文（含下级标签）')).toBeTruthy();
    expect(view.queryByRole('row')).toBeNull();
  });

  it('assigns a paper on the whole row without opening details or entering a folder, and clears cancelled drops', () => {
    const onOpen = vi.fn(), onAssignEntryToTag = vi.fn();
    const view = render(<LibraryTagNavigationItem node={node} onOpen={onOpen} onAssignEntryToTag={onAssignEntryToTag} />);
    const row = view.getByRole('button', { name: '打开标签 研究/空主题' });
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 860, top: 20, bottom: 56 } as DOMRect);
    act(() => beginEntryTagDrag('paper', 800, 30));
    expect(row.className).toContain('bg-primary/10');
    act(() => cancelEntryTagDrag());
    expect(row.className).not.toContain('bg-primary/10');
    expect(onAssignEntryToTag).not.toHaveBeenCalled();
    act(() => beginEntryTagDrag('paper', 800, 30));
    act(() => finishEntryTagDrag(800, 30));
    expect(onAssignEntryToTag).toHaveBeenCalledExactlyOnceWith('paper', node.path);
    expect(onOpen).not.toHaveBeenCalled();
    act(() => beginEntryTagDrag('paper', 800, 30));
    view.unmount();
    act(() => finishEntryTagDrag(800, 30));
    expect(onAssignEntryToTag).toHaveBeenCalledOnce();
  });
});
