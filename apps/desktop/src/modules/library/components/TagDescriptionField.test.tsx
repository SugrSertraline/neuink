// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSurfaceCloseGuard } from '@/app/useSurfaceCloseGuard';
import type { TagMeta } from '@/shared/types/domain';
import { TagDescriptionField } from './TagDescriptionField';

const tag: TagMeta = { id: 'a', name: '主题 A', parent_id: null, description: '原始描述', created_at: '', updated_at: '' };
afterEach(cleanup);

describe('TagDescriptionField', () => {
  it.each([false, true])('saves with its original value and returns focus with inline=%s', async (inline) => {
    const onSave = vi.fn(async (_id, description) => ({ ...tag, description }));
    const view = render(<TagDescriptionField tag={tag} scope="library/tag:a" onSave={onSave} inline={inline} />);
    expect(view.queryByRole('textbox')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '编辑标签描述' }));
    fireEvent.change(view.getByRole('textbox', { name: '标签描述' }), { target: { value: '新的研究目标' } });
    fireEvent.click(view.getByRole('button', { name: '保存描述' }));
    await waitFor(() => expect(view.queryByRole('textbox')).toBeNull());
    expect(onSave).toHaveBeenCalledExactlyOnceWith('a', '新的研究目标', '原始描述');
    expect(view.getByText('新的研究目标')).toBeTruthy();
    expect(document.activeElement).toBe(view.getByRole('button', { name: '编辑标签描述' }));
  });

  it.each([false, true])('keeps changes typed during a save and the next base with inline=%s', async (inline) => {
    let finish!: (value: TagMeta) => void;
    const onSave = vi.fn(() => new Promise<TagMeta>(resolve => { finish = resolve; }));
    const view = render(<TagDescriptionField tag={tag} scope="library/tag:a" onSave={onSave} inline={inline} />);
    fireEvent.click(view.getByRole('button', { name: '编辑标签描述' }));
    const input = view.getByRole('textbox', { name: '标签描述' });
    fireEvent.change(input, { target: { value: '第一版' } });
    fireEvent.click(view.getByRole('button', { name: '保存描述' }));
    fireEvent.change(input, { target: { value: '第二版' } });
    await act(async () => finish({ ...tag, description: '第一版' }));
    expect((input as HTMLTextAreaElement).value).toBe('第二版');
    expect(view.getByRole('status').textContent).toBe('未保存');
    fireEvent.click(view.getByRole('button', { name: '保存描述' }));
    expect(onSave).toHaveBeenLastCalledWith('a', '第二版', '第一版');
    await act(async () => finish({ ...tag, description: '第二版' }));
  });

  it('protects a library description on tag navigation and remains on the same tag after a failed save', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('描述已被修改，请重新载入')).mockResolvedValue({ ...tag, description: '未保存目标' });
    function Harness() {
      const [selected, setSelected] = useState(tag);
      const guard = useSurfaceCloseGuard({ root: 'library-root', onClose: vi.fn() });
      return <><h1>{selected.name}</h1><TagDescriptionField key={selected.id} tag={selected} scope={`library/tag:${selected.id}`} onSave={onSave} />
        <button onClick={() => guard.requestClose([{ pane: 'left', surface: { kind: 'library' } }], () => setSelected({ ...tag, id: 'b', name: '主题 B' }))}>切换标签</button>{guard.dialog}</>;
    }
    const view = render(<Harness />);
    fireEvent.click(view.getByRole('button', { name: '编辑标签描述' }));
    fireEvent.change(view.getByRole('textbox'), { target: { value: '未保存目标' } });
    fireEvent.click(view.getByRole('button', { name: '切换标签' }));
    expect(view.getByRole('dialog')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.getByRole('button', { name: '保存并继续' }).hasAttribute('disabled')).toBe(false));
    expect(view.getByRole('heading', { name: '主题 A', hidden: true })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(view.getByRole('heading', { name: '主题 B' })).toBeTruthy());
    expect(view.queryByRole('dialog')).toBeNull();
  });
});
