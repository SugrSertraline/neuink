// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TagMeta } from '@/shared/types/domain';
import { TagEditorPage } from './TagEditorPage';

afterEach(cleanup);

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
});
