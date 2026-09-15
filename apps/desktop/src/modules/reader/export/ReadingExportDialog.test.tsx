// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import type { ReadingExportCatalog } from '@/shared/ipc/readingExportApi';
import { clearMarkdownNoteDirty, registerMarkdownNoteSaveHandler, setMarkdownNoteDirty } from '../../notes/editor/noteDirtyRegistry';
import { ReadingExportDialog } from './ReadingExportDialog';
import { setSegmentEditorDirty } from '../components/segmentEditorDirtyRegistry';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), export: vi.fn(), tagInspect: vi.fn(), tagExport: vi.fn(), save: vi.fn(), notify: vi.fn(), close: vi.fn() }));
vi.mock('@/shared/ipc/noteOwnerApi', () => ({ inspectTagNoteExport: mocks.tagInspect, exportTagNotes: mocks.tagExport }));
vi.mock('@/shared/ipc/readingExportApi', () => ({ inspectReadingExport: mocks.inspect, exportReading: mocks.export }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
const catalog: ReadingExportCatalog = { entry_title: '论文', items: [
  { id: 'note:n1', note_id: 'n1', title: '文档甲', kind: 'note', page: null, preview: '保存的正文', fingerprint: 'n1-v1', warnings: [] },
  { id: 'note:n2', note_id: 'n2', title: '文档乙', kind: 'note', page: null, preview: '私人笔记', fingerprint: 'n2-v1', warnings: [] },
  { id: 'translation:s1', note_id: null, title: '第 1 页译文', kind: 'translation', page: 1, preview: '翻译后的片段', fingerprint: 's1-v1', warnings: [] }
] };
function view(noteId?: string, entryId = 'e1', root: string | null = 'C:/library') {
  return <ToastContext.Provider value={{ notify: mocks.notify, dismiss: vi.fn() }}>
    <ReadingExportDialog entryId={entryId} entryTitle="论文" workspaceRoot={root} noteId={noteId} open onOpenChange={mocks.close} />
  </ToastContext.Provider>;
}
const exportButton = () => screen.getByRole<HTMLButtonElement>('button', { name: '选择位置并导出' });
const check = (title: string) => fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${title}` }));
const ready = () => screen.findByText('保存的正文');
const cleanupHandlers: (() => void)[] = [];
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.inspect.mockResolvedValue(catalog);
  mocks.export.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue('C:/exports/notes.zip');
});
afterEach(() => {
  cleanup();
  for (const unregister of cleanupHandlers.splice(0)) unregister();
  clearMarkdownNoteDirty('e1', 'n1');
  clearMarkdownNoteDirty('e1', 'n2');
  setSegmentEditorDirty('pdf:e1', 'fragment-owner', false);
});

describe('ReadingExportDialog', () => {
  it('exports a tag-owned note with the same reviewed selection and Word default', async () => {
    mocks.tagInspect.mockResolvedValue({ ...catalog, items: catalog.items.slice(0, 1) });
    render(<ToastContext.Provider value={{ notify: mocks.notify, dismiss: vi.fn() }}><ReadingExportDialog entryId="tag-reading:t1" tagId="t1" entryTitle="主题" workspaceRoot="C:/library" noteId="n1" open onOpenChange={mocks.close} /></ToastContext.Provider>);
    await ready(); fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.tagExport).toHaveBeenCalledWith('C:/library', 't1', expect.objectContaining({ format: 'docx', selected: [{ id: 'note:n1', fingerprint: 'n1-v1' }] })));
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.export).not.toHaveBeenCalled();
  });
  it('blocks exporting saved fragments while a reader still has unsaved fragment edits', async () => {
    setSegmentEditorDirty('pdf:e1', 'fragment-owner', true);
    render(view());
    await ready();
    check('第 1 页译文');
    fireEvent.click(exportButton());
    expect((await screen.findByRole('alert')).textContent).toContain('回到阅读页面保存');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it('starts with no implicit sharing selection and exports only checked versions', async () => {
    render(view());
    expect(exportButton().disabled).toBe(true);
    await ready();
    expect(exportButton().disabled).toBe(true);
    check('文档甲');
    check('第 1 页译文');
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalledWith({ root: 'C:/library', entry_id: 'e1',
      selected: [{ id: 'note:n1', fingerprint: 'n1-v1' }, { id: 'translation:s1', fingerprint: 's1-v1' }],
      format: 'txt_zip', target_path: 'C:/exports/notes.zip', allow_incomplete: false }));
    expect(mocks.close).toHaveBeenCalledWith(false);
  });

  it('preselects only the explicitly opened note and defaults to Word, including read-only saved notes', async () => {
    render(view('n1'));
    await ready();
    expect(screen.getByRole('checkbox', { name: '选择 文档甲' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: '选择 文档乙' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.inspect).toHaveBeenCalledWith('C:/library', 'e1', 'n1');
    expect(mocks.export.mock.calls[0][0]).toMatchObject({ format: 'docx', selected: [{ id: 'note:n1', fingerprint: 'n1-v1' }] });
  });

  it('does not export on canceled native save and permits retry', async () => {
    mocks.save.mockResolvedValue(null);
    render(view('n1'));
    await ready();
    fireEvent.click(exportButton());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('blocks unsaved notes and saves only selected notes through their registered owners', async () => {
    setMarkdownNoteDirty('e1', 'n1', 'owner', true);
    setMarkdownNoteDirty('e1', 'n2', 'owner', true);
    const saveSelected = vi.fn(async () => { clearMarkdownNoteDirty('e1', 'n1'); return true; });
    const saveUnselected = vi.fn(async () => true);
    cleanupHandlers.push(registerMarkdownNoteSaveHandler('e1', 'n1', 'owner', saveSelected));
    cleanupHandlers.push(registerMarkdownNoteSaveHandler('e1', 'n2', 'owner', saveUnselected));
    render(view('n1'));
    await ready();
    fireEvent.click(exportButton());
    expect((await screen.findByRole('alert')).textContent).toContain('未保存修改');
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存所选笔记并刷新' }));
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2));
    expect(saveSelected).toHaveBeenCalledOnce();
    expect(saveUnselected).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
    await waitFor(() => expect(exportButton().disabled).toBe(false));
  });

  it('keeps a save conflict visible and does not write an old saved note', async () => {
    setMarkdownNoteDirty('e1', 'n1', 'owner', true);
    cleanupHandlers.push(registerMarkdownNoteSaveHandler('e1', 'n1', 'owner', async () => false));
    render(view('n1'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '保存所选笔记并刷新' }));
    expect((await screen.findByRole('alert')).textContent).toContain('版本冲突');
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('rechecks dirty state after the native dialog returns', async () => {
    mocks.save.mockImplementation(async () => { setMarkdownNoteDirty('e1', 'n1', 'owner', true); return 'C:/exports/n.docx'; });
    render(view('n1'));
    await ready();
    fireEvent.click(exportButton());
    expect((await screen.findByRole('alert')).textContent).toContain('期间笔记又有修改');
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('requires acknowledgement only for selected warnings, resetting it on selection changes', async () => {
    mocks.inspect.mockResolvedValue({ ...catalog, items: catalog.items.map((item) => item.id === 'note:n1' ? { ...item, warnings: ['缺失图片'] } : item) });
    render(view());
    await ready();
    check('文档乙');
    expect(exportButton().disabled).toBe(false);
    check('文档甲');
    expect(exportButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: '保留待核对提示并导出' }));
    expect(exportButton().disabled).toBe(false);
    check('第 1 页译文');
    expect(exportButton().disabled).toBe(true);
  });

  it('does not allow repeated exports or closing while native save is pending', async () => {
    let resolve!: (value: string | null) => void;
    mocks.save.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(view('n1'));
    await ready();
    fireEvent.click(exportButton());
    fireEvent.click(screen.getByRole('button', { name: '正在处理…' }));
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消' }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(mocks.close).not.toHaveBeenCalled();
    resolve(null);
    await waitFor(() => expect(exportButton().disabled).toBe(false));
  });

  it('drops late inspection results after context changes', async () => {
    let resolve!: (value: ReadingExportCatalog) => void;
    mocks.inspect.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { rerender } = render(view());
    rerender(view(undefined, 'e2'));
    await ready();
    resolve({ entry_title: '旧条目', items: [] });
    check('文档甲');
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].entry_id).toBe('e2');
  });

  it('does not write after dialog unmounts while native save was pending', async () => {
    let resolve!: (value: string) => void;
    mocks.save.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { unmount } = render(view('n1'));
    await ready();
    fireEvent.click(exportButton());
    unmount();
    resolve('C:/exports/n.docx');
    await Promise.resolve();
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('handles empty content, unavailable workspace, inspection failure and retry', async () => {
    mocks.inspect.mockResolvedValueOnce({ entry_title: '论文', items: [] });
    const first = render(view());
    await screen.findByText(/暂无可导出的阅读成果/);
    expect(exportButton().disabled).toBe(true);
    first.unmount();
    const second = render(view(undefined, 'e1', null));
    expect((await screen.findByRole('alert')).textContent).toContain('资料库不可用');
    second.unmount();
    mocks.inspect.mockRejectedValueOnce('清单读取失败');
    render(view());
    expect((await screen.findByRole('alert')).textContent).toContain('清单读取失败');
    fireEvent.click(screen.getByRole('button', { name: '刷新后重试' }));
    await ready();
  });

  it('preserves selection on refresh but uses the newly reviewed fingerprint', async () => {
    render(view('n1'));
    await ready();
    mocks.inspect.mockResolvedValue({ ...catalog, items: [{ ...catalog.items[0], fingerprint: 'n1-v2' }] });
    fireEvent.click(screen.getByRole('button', { name: '刷新清单' }));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].selected).toEqual([{ id: 'note:n1', fingerprint: 'n1-v2' }]);
  });
});
