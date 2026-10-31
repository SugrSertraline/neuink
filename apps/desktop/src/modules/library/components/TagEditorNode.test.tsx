// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagEditorNode } from './TagEditorNode';

afterEach(cleanup);

describe('TagEditorNode', () => {
  it('selects on click, opens on double click or keyboard, and toggles a branch', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    const node = { children: [{ children: [], count: 0, depth: 1, id: 'child', name: '子标签', parentId: 'research', path: '研究/子标签' }],
      count: 2, depth: 0, id: 'research', name: '研究', parentId: null, path: '研究' };
    const view = render(<TagEditorNode node={node} active={false} selected={true} expanded={true} busy={false}
      onSelect={onSelect} onOpen={onOpen} onToggle={onToggle} />);

    const tag = view.getByRole('button', { name: '选择标签 研究' });
    fireEvent.click(tag, { detail: 1 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(tag);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(tag, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
    const disclosure = view.getByRole('button', { name: '收起 研究' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(disclosure);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
