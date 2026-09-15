// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TagEditorNode } from './TagEditorNode';

afterEach(cleanup);

describe('TagEditorNode', () => {
  it('uses the shared double-click-to-open contract while preserving keyboard activation', () => {
    const onSelectTag = vi.fn();
    const view = render(
      <TagEditorNode
        activeTag={null}
        busy={false}
        childName=""
        creatingChildForId={null}
        editingId={null}
        editingName=""
        node={{ children: [], count: 2, depth: 0, id: 'research', name: '研究', parentId: null, path: '研究' }}
        onCreateChild={vi.fn()}
        onDeleteRequest={vi.fn()}
        onEdit={vi.fn()}
        onRename={vi.fn()}
        onSelectTag={onSelectTag}
        onSetChildName={vi.fn()}
        onSetEditingName={vi.fn()}
        onStartCreateChild={vi.fn()}
        onStopCreateChild={vi.fn()}
        onStopEdit={vi.fn()}
      />
    );

    const tag = view.getByRole('button', { name: '打开标签 研究' });
    expect(tag.getAttribute('title')).toBe('双击打开：研究');
    fireEvent.click(tag, { detail: 1 });
    expect(onSelectTag).not.toHaveBeenCalled();
    fireEvent.doubleClick(tag);
    expect(onSelectTag).toHaveBeenCalledExactlyOnceWith('research');
    onSelectTag.mockClear();
    fireEvent.click(tag, { detail: 0 });
    expect(onSelectTag).toHaveBeenCalledExactlyOnceWith('research');
  });
});
