// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagDetailsView } from './TagDetailsView';

vi.mock('@/modules/notes/components/TagNotesList', () => ({ TagNotesList: () => <div>标签笔记列表</div> }));
afterEach(cleanup);

describe('TagDetailsView navigation', () => {
  const tag = { id: 'topic', name: '研究', parent_id: null, description: '原始描述', created_at: '', updated_at: '' };
  const props = { root: '/library', tagId: tag.id, tags: [tag], entries: [], onDescription: vi.fn(), onOpenNote: vi.fn(), onOpenEntry: vi.fn(), onReading: vi.fn(), onManage: vi.fn(), onTrash: vi.fn() };

  it('keeps the current subtab and the description draft when the same details tab is opened again', () => {
    const view = render(<TagDetailsView {...props} initialView="notes" />);
    fireEvent.mouseDown(view.getByRole('tab', { name: '概览' }), { button: 0, ctrlKey: false });
    fireEvent.change(view.getByRole('textbox', { name: '描述' }), { target: { value: '尚未保存的研究问题' } });
    view.rerender(<TagDetailsView {...props} />);
    expect(view.getByRole('tab', { name: '概览' }).getAttribute('aria-selected')).toBe('true');
    expect((view.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('尚未保存的研究问题');
    expect(view.getByText('有未保存修改')).toBeTruthy();
  });

  it('shows an archived tag as unavailable and lets the user open the recycle bin', () => {
    const onTrash = vi.fn();
    const view = render(<TagDetailsView {...props} tags={[]} onTrash={onTrash} />);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.getByText(/标签已移入回收站或不可用/)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '打开回收站' }));
    expect(onTrash).toHaveBeenCalledOnce();
  });
});
