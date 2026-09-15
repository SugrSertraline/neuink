// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import type { TagNode } from '../utils/tagTree';
import { SidebarTagTreeItem } from './SidebarTagTreeItem';
import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag } from '@/shared/lib/entryDragData';

afterEach(() => { cleanup(); cancelEntryTagDrag(); vi.restoreAllMocks(); });

function TreeItem(props: { activeTag: string | null; node: TagNode; onAssignEntryToTag: (entryId: string, path: string) => void; onOpenTagDetails: (id: string) => void }) {
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>());
  return <SidebarTagTreeItem {...props} expandedIds={expandedIds} density="compact" showCounts onToggle={id => setExpandedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  })} />;
}

describe('SidebarTagTreeItem', () => {
  it('keeps branch expansion separate from tag selection', () => {
    const onOpenTagDetails = vi.fn();
    const node: TagNode = {
      children: [
        {
          children: [],
          count: 2,
          depth: 1,
          id: 'hci',
          name: 'HCI',
          parentId: 'research',
          path: '研究/HCI'
        }
      ],
      count: 3,
      depth: 0,
      id: 'research',
      name: '研究',
      parentId: null,
      path: '研究'
    };
    const view = render(
      <TreeItem
        activeTag={null}
        node={node}
        onAssignEntryToTag={() => undefined}
        onOpenTagDetails={onOpenTagDetails}
      />
    );

    const expandButton = view.getByRole('button', { name: '展开 研究' });
    const rootTagButton = view.getByRole('button', { name: '打开标签 研究' });
    expect(rootTagButton.querySelector('[data-count-kind="children"]')?.textContent).toBe('1');
    expect(rootTagButton.querySelector('[data-count-kind="papers"]')?.textContent).toBe('3');
    expect(rootTagButton.querySelector('[title]')?.getAttribute('title')).toBe('1 个直属子标签；3 篇论文（包含子标签，同一论文只计一次）');
    expect(expandButton.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByRole('button', { name: '打开标签 研究/HCI' })).toBeNull();
    fireEvent.click(expandButton);
    expect(onOpenTagDetails).not.toHaveBeenCalled();
    const collapseButton = view.getByRole('button', { name: '收起 研究' });
    expect(view.getByRole('button', { name: '打开标签 研究/HCI' }).querySelector('[data-count-kind="children"]')).toBeNull();
    expect(view.getByRole('button', { name: '打开标签 研究/HCI' }).querySelector('[data-count-kind="papers"]')?.textContent).toBe('2');
    expect(collapseButton.getAttribute('data-slot')).toBe('button');
    expect(collapseButton.getAttribute('data-variant')).toBe('plain');
    expect(collapseButton.className).not.toContain('aria-expanded:bg-muted');
    expect(collapseButton.parentElement?.className).toContain('hover:bg-muted');
    expect(view.getByRole('button', { name: '打开标签 研究' }).className).not.toContain('hover:bg-muted');
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapseButton);
    expect(view.queryByRole('button', { name: '打开标签 研究/HCI' })).toBeNull();
    expect(onOpenTagDetails).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '展开 研究' }));
    const tagButton = view.getByRole('button', { name: '打开标签 研究/HCI' });
    fireEvent.click(tagButton, { detail: 1 });
    expect(onOpenTagDetails).toHaveBeenCalledExactlyOnceWith('hci');
    onOpenTagDetails.mockClear();
    fireEvent.click(tagButton, { detail: 0 });
    expect(onOpenTagDetails).toHaveBeenCalledWith('hci');
    view.rerender(<TreeItem activeTag="research" node={node} onAssignEntryToTag={() => undefined} onOpenTagDetails={onOpenTagDetails} />);
    expect(view.getByRole('button', { name: '收起 研究' }).parentElement?.className).toContain('bg-accent');
    expect(view.getByRole('button', { name: '打开标签 研究' }).className).not.toContain('bg-accent');
    expect(view.getByRole('button', { name: '打开标签 研究' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps full-row drop feedback distinct from hover and clears it after cancellation', () => {
    const onDrop = vi.fn();
    const node: TagNode = { children: [], count: 0, depth: 0, id: 'tag', name: '目标', parentId: null, path: '目标' };
    const view = render(<TreeItem activeTag={null} node={node} onAssignEntryToTag={onDrop} onOpenTagDetails={vi.fn()} />);
    const row = view.getByRole('button', { name: '打开标签 目标' }).parentElement!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 210, top: 10, bottom: 40 } as DOMRect);
    act(() => beginEntryTagDrag('entry', 20, 20));
    expect(row.className).toContain('bg-primary/10');
    expect(row.className).not.toContain('hover:bg-muted');
    act(() => cancelEntryTagDrag());
    expect(onDrop).not.toHaveBeenCalled();
    expect(row.className).not.toContain('bg-primary/10');
    act(() => beginEntryTagDrag('entry', 20, 20));
    act(() => finishEntryTagDrag(20, 20));
    expect(onDrop).toHaveBeenCalledExactlyOnceWith('entry', '目标');
  });
});
