// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { hasUnsavedEntrySegmentEditors, hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { EntryEditPage } from './EntryEditPage';
import type { LibraryEntry } from './LibrarySidebar';

afterEach(cleanup);
const entry: LibraryEntry = { id: 'edit-test', title: '原论文', tags: ['研究'], tagIds: [], fields: { 描述: '原描述', DOI: '10.123/example' },
  contents: [], pdfFileName: 'paper.pdf', status: 'Parsed', progress: 100, createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null };
const scope = `entry-overview:${entry.id}`;
const toast = { notify: vi.fn(() => 'toast'), dismiss: vi.fn() };
function page(props: Partial<React.ComponentProps<typeof EntryEditPage>> = {}) {
  return <ToastContext.Provider value={toast}><EntryEditPage entry={entry} tags={[]} workspaceRoot="edit-test-root" scopeKey={scope} onUpdateEntry={vi.fn()} onBack={vi.fn()} {...props} /></ToastContext.Provider>;
}

describe('entry page editing', () => {
  it('edits in a page, saves title/description/tags/properties with Ctrl+S and clears the close guard', async () => {
    const onUpdateEntry = vi.fn().mockResolvedValue(undefined), onBack = vi.fn();
    const view = render(page({ onUpdateEntry, onBack }));
    expect(view.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(view.getByLabelText('标题'));
    fireEvent.change(view.getByLabelText('标题'), { target: { value: ' 新论文 ' } });
    fireEvent.change(view.getByLabelText('描述'), { target: { value: ' 新描述 ' } });
    fireEvent.change(view.getByLabelText('标签'), { target: { value: '研究, 软件工程/需求, 研究' } });
    expect(hasUnsavedEntrySegmentEditors(entry.id)).toBe(true);
    fireEvent.keyDown(view.getByLabelText('标题'), { key: 's', ctrlKey: true });
    await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    expect(onUpdateEntry).toHaveBeenCalledWith(entry.id, { title: '新论文', fields: { description: '新描述', DOI: '10.123/example' }, tagPaths: ['研究', '软件工程/需求'] });
    expect(hasUnsavedSegmentEditors(scope)).toBe(false);
  });

  it('retains unsaved edits on return/cancel, and supports explicit discard', () => {
    const onBack = vi.fn(); const view = render(page({ onBack }));
    fireEvent.change(view.getByLabelText('标题'), { target: { value: '草稿' } });
    fireEvent.click(view.getByRole('button', { name: '返回概览' }));
    expect(view.getByRole('dialog')).toBeTruthy(); expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: '取消' }));
    expect((view.getByLabelText('标题') as HTMLInputElement).value).toBe('草稿');
    fireEvent.click(view.getByRole('button', { name: '返回概览' }));
    fireEvent.click(view.getByRole('button', { name: '放弃未保存修改并继续' }));
    expect(onBack).toHaveBeenCalledOnce(); expect(hasUnsavedSegmentEditors(scope)).toBe(false);
  });

  it('keeps a failed save dirty and allows retry through the workspace close registry', async () => {
    const onUpdateEntry = vi.fn().mockRejectedValueOnce(new Error('磁盘写入失败')).mockResolvedValue(undefined);
    const onBack = vi.fn(); const view = render(page({ onUpdateEntry, onBack }));
    fireEvent.change(view.getByLabelText('标题'), { target: { value: '仍需保存' } });
    fireEvent.click(view.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('磁盘写入失败'));
    expect(onBack).not.toHaveBeenCalled(); expect(hasUnsavedSegmentEditors(scope)).toBe(true);
    await act(async () => { expect(await saveSegmentEditorsBeforeClose(scope)).toBe(true); });
    expect(onUpdateEntry).toHaveBeenCalledTimes(2); expect(hasUnsavedSegmentEditors(scope)).toBe(false);
  });

  it('does not overwrite external metadata changes or replace the draft during a parse refresh', async () => {
    const onUpdateEntry = vi.fn(); const view = render(page({ onUpdateEntry }));
    fireEvent.change(view.getByLabelText('标题'), { target: { value: '本地草稿' } });
    view.rerender(page({ onUpdateEntry, entry: { ...entry, status: 'Parsing', progress: 10 } }));
    expect((view.getByLabelText('标题') as HTMLInputElement).value).toBe('本地草稿');
    view.rerender(page({ onUpdateEntry, entry: { ...entry, tags: ['研究', '其他位置新增'] } }));
    fireEvent.click(view.getByRole('button', { name: '保存修改' }));
    expect(view.getByRole('alert').textContent).toContain('已在其他位置更新');
    expect(onUpdateEntry).not.toHaveBeenCalled();
  });

  it('rejects an empty title and unregisters draft safety after unmount', async () => {
    const onUpdateEntry = vi.fn(); const view = render(page({ onUpdateEntry }));
    fireEvent.change(view.getByLabelText('标题'), { target: { value: ' ' } });
    expect((view.getByRole('button', { name: '保存修改' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { expect(await saveSegmentEditorsBeforeClose(scope)).toBe(false); });
    expect(view.getByRole('alert').textContent).toContain('请输入条目标题'); expect(onUpdateEntry).not.toHaveBeenCalled();
    view.unmount(); expect(hasUnsavedEntrySegmentEditors(entry.id)).toBe(false);
  });
});
