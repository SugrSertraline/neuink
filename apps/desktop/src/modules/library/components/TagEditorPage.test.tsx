// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagMeta } from '@/shared/types/domain';
import { TagEditorPage } from './TagEditorPage';

class Pointer extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}
beforeEach(() => vi.stubGlobal('PointerEvent', Pointer));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tags: TagMeta[] = [
  { id: 'root', name: '研究', parent_id: null, created_at: '', updated_at: '' },
  { id: 'child', name: '视觉', parent_id: 'root', created_at: '', updated_at: '' }
];

function showEditor(overrides: Partial<React.ComponentProps<typeof TagEditorPage>> = {}) {
  const onRenameTag = vi.fn().mockResolvedValue(undefined);
  const onCreateTagPath = vi.fn().mockResolvedValue(undefined);
  const onSelectTag = vi.fn();
  render(<TagEditorPage standalone activeTag={null} entries={[]} tags={tags} onCreateTagPath={onCreateTagPath}
    onDeleteTag={vi.fn()} onRenameTag={onRenameTag} onSelectTag={onSelectTag} {...overrides} />);
  return { onRenameTag, onCreateTagPath, onSelectTag };
}

describe('TagEditorPage', () => {
  it('collapses and expands the tree while keeping the selected tag editable', () => {
    showEditor();
    const graph = screen.getByLabelText('标签树图');
    fireEvent.click(within(graph).getByRole('button', { name: '选择标签 研究/视觉' }), { detail: 1 });
    expect(within(screen.getByLabelText('标签编辑')).getByText('视觉')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '收起全部' }));
    expect(within(graph).queryByRole('button', { name: '选择标签 研究/视觉' })).toBeNull();
    expect(within(screen.getByLabelText('标签编辑')).getByRole('heading', { name: '研究' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '展开全部' }));
    expect(within(graph).getByRole('button', { name: '选择标签 研究/视觉' })).toBeTruthy();
  });

  it('renames and adds a child from the inspector', async () => {
    const { onRenameTag, onCreateTagPath } = showEditor();
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '重命名标签' }), { target: { value: '新研究' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onRenameTag).toHaveBeenCalledWith('root', '新研究'));
    await waitFor(() => expect(screen.getByRole('button', { name: '添加子标签' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '添加子标签' }));
    fireEvent.change(screen.getByRole('textbox', { name: '添加到“研究”下' }), { target: { value: '机器学习' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onCreateTagPath).toHaveBeenCalledWith('研究/机器学习'));
  });

  it('keeps the draft and shows an error when saving fails', async () => {
    showEditor({ onRenameTag: vi.fn().mockRejectedValue(new Error('保存失败')) });
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '重命名标签' }), { target: { value: '保留草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失败');
    expect(screen.getByRole('textbox', { name: '重命名标签' })).toHaveProperty('value', '保留草稿');
  });

  it('pans from blank canvas, leaves node clicks alone, and resets the view', () => {
    showEditor();
    const graph = screen.getByLabelText('标签树图');
    Object.assign(graph, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    const stage = graph.querySelector<HTMLElement>('[data-tag-editor-stage]')!;
    fireEvent.pointerDown(graph, { pointerId: 7, button: 0, clientX: 100, clientY: 100, pointerType: 'mouse' });
    fireEvent.pointerMove(graph, { pointerId: 7, clientX: 60, clientY: 80 });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.pointerUp(graph, { pointerId: 7 });

    fireEvent.pointerDown(within(graph).getByRole('button', { name: '选择标签 研究' }),
      { pointerId: 8, button: 0, clientX: 50, clientY: 50, pointerType: 'mouse' });
    fireEvent.pointerMove(graph, { pointerId: 8, clientX: 10, clientY: 10 });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.pointerDown(graph, { pointerId: 9, button: 0, clientX: 100, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(graph, { pointerId: 9, clientX: 130, clientY: 130 });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.pointerDown(graph, { pointerId: 10, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 10, clientX: 120, clientY: 130 });
    fireEvent.keyDown(graph, { key: 'Escape' });
    expect(stage.style.transform).toBe('translate3d(-40px, -20px, 0)');
    fireEvent.click(screen.getByRole('button', { name: '视图居中' }));
    expect(stage.style.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('edits the tag that was right-clicked', () => {
    showEditor();
    fireEvent.contextMenu(screen.getByRole('button', { name: '选择标签 研究/视觉' }), { clientX: 80, clientY: 90 });
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    expect(screen.getByRole('textbox', { name: '重命名标签' })).toHaveProperty('value', '视觉');
  });
});
