// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import type { PaperExportInspection } from '@/shared/ipc/exportApi';
import { PaperExportDialog } from './PaperExportDialog';
import { DEFAULT_EXPORT_OPTIONS } from './PaperExportOptionsFields';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), export: vi.fn(), save: vi.fn(), notify: vi.fn(), close: vi.fn(), render: vi.fn() }));
vi.mock('./renderExportDiagrams', () => ({ renderExportDiagrams: mocks.render }));
vi.mock('@/shared/ipc/exportApi', () => ({ inspectPaperExport: mocks.inspect, exportPaper: mocks.export }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
const report: PaperExportInspection = {
  fingerprint: 'current-source', total: 3, translated: 0, preserved: 3,
  missing: 0, stale: 0, unverified_images: 0, missing_assets: 0, requires_draft: false, issues: [], diagrams: []
};
function view(entryId = 'entry-1', root: string | null = 'C:/library') {
  return <ToastContext.Provider value={{ notify: mocks.notify, dismiss: vi.fn() }}>
    <PaperExportDialog entryId={entryId} entryTitle="研究论文" workspaceRoot={root} open onOpenChange={mocks.close} />
  </ToastContext.Provider>;
}
function exportButton() { return screen.getByRole<HTMLButtonElement>('button', { name: /^(选择位置并导出|继续导出（含待核对内容）)$/ }); }
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.inspect.mockResolvedValue(report);
  mocks.export.mockResolvedValue(report);
  mocks.save.mockResolvedValue('C:/exports/paper.docx');
  mocks.notify.mockReturnValue('toast');
  mocks.render.mockResolvedValue([{ id: 'diagram-1', png_base64: 'png' }]);
});
afterEach(cleanup);

describe('PaperExportDialog', () => {
  it('blocks export until content inspection completes', async () => {
    let resolve!: (value: PaperExportInspection) => void;
    mocks.inspect.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(view());
    expect(exportButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('正在检查');
    resolve(report);
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    expect(mocks.inspect).toHaveBeenCalledWith('C:/library', 'entry-1', 'source', DEFAULT_EXPORT_OPTIONS);
  });
  it('exports Word with the inspected version and an explicit target', async () => {
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalledWith({
      root: 'C:/library', entry_id: 'entry-1', kind: 'source', format: 'docx',
      target_path: 'C:/exports/paper.docx', expected_fingerprint: 'current-source', allow_draft: false,
      options: DEFAULT_EXPORT_OPTIONS, rendered_diagrams: []
    }));
    expect(mocks.save.mock.calls[0][0].defaultPath).toBe('研究论文-解析全文.docx');
    expect(mocks.close).toHaveBeenCalledWith(false);
  });
  it.each([
    { counts: { missing: 2 }, notice: '2 项缺译' },
    { counts: { stale: 1 }, notice: '1 项旧译文' },
    { counts: { missing_assets: 1 }, notice: '1 项缺失图片' }
  ])('acknowledges $notice through the explicit continue action without an extra switch', async ({ counts, notice }) => {
    mocks.inspect.mockResolvedValue({ ...report, ...counts, requires_draft: true,
      issues: [{ segment_uid: 's1', page: 2, message: notice }] });
    render(view());
    await screen.findByText('查看 1 项内容检查结果');
    expect(exportButton().disabled).toBe(false);
    expect(exportButton().textContent).toBe('继续导出（含待核对内容）');
    const description = document.getElementById(exportButton().getAttribute('aria-describedby')!);
    expect(description?.textContent).toContain(notice);
    expect(description?.textContent).toContain('并将文件标记为草稿');
    expect(screen.queryByRole('switch', { name: '允许导出草稿' })).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toMatchObject({ allow_draft: true, expected_fingerprint: report.fingerprint });
    expect(mocks.save.mock.calls[0][0].defaultPath).toContain('草稿');
  });
  it.each([
    { kind: 'translation', label: '中文译稿' },
    { kind: 'bilingual', label: '中英对照' }
  ])('exports $label normally when only image text is unverified', async ({ kind, label }) => {
    mocks.inspect.mockImplementation((_root, _entry, selectedKind) => Promise.resolve(selectedKind === 'source' ? report : {
      ...report, fingerprint: 'image-notice-only', translated: 2, preserved: 1, unverified_images: 1,
      issues: [{ segment_uid: 's1', page: 2, message: '图中文字未做 OCR 翻译核验' }]
    }));
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '导出内容' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: label }));
    await screen.findByText('1 项图中文字未做翻译核验，仅作提醒，不影响导出。');
    expect(exportButton().disabled).toBe(false);
    expect(exportButton().textContent).toBe('选择位置并导出');
    expect(screen.queryByRole('switch', { name: '允许导出草稿' })).toBeNull();
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toMatchObject({ kind, allow_draft: false, expected_fingerprint: 'image-notice-only' });
    expect(mocks.save.mock.calls[0][0].defaultPath).toBe(`研究论文-${label}.docx`);
  });
  it('does not retain draft permission after rechecking finds no missing content', async () => {
    mocks.inspect.mockResolvedValueOnce({ ...report, missing_assets: 1, requires_draft: true });
    render(view());
    await screen.findByRole('button', { name: '继续导出（含待核对内容）' });
    fireEvent.click(screen.getByRole('switch', { name: '显示逐段来源编号' }));
    await waitFor(() => expect(exportButton().textContent).toBe('选择位置并导出'));
    expect(exportButton().hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].allow_draft).toBe(false);
    expect(mocks.save.mock.calls[0][0].defaultPath).not.toContain('草稿');
  });
  it('does not write or close on canceled native save', async () => {
    mocks.save.mockResolvedValue(null);
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it('shows inspection errors and supports retry', async () => {
    mocks.inspect.mockRejectedValueOnce('没有可导出的解析内容');
    render(view());
    expect((await screen.findByRole('alert')).textContent).toContain('没有可导出的解析内容');
    expect(exportButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
  });
  it('ignores late results for the previously selected entry', async () => {
    let resolve!: (value: PaperExportInspection) => void;
    mocks.inspect.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    mocks.inspect.mockResolvedValueOnce({ ...report, fingerprint: 'entry-2-source' });
    const { rerender } = render(view());
    rerender(view('entry-2'));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    resolve({ ...report, fingerprint: 'old-entry-1' });
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toMatchObject({ entry_id: 'entry-2', expected_fingerprint: 'entry-2-source' });
  });
  it('rechecks translation scope with keyboard-accessible selectors', async () => {
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '导出内容' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '中文译稿' }));
    await waitFor(() => expect(mocks.inspect).toHaveBeenLastCalledWith('C:/library', 'entry-1', 'translation', DEFAULT_EXPORT_OPTIONS));
  });
  it('prevents closing and duplicate submissions while saving', async () => {
    let resolve!: () => void;
    mocks.export.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalledOnce());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '正在导出…' }).disabled).toBe(true);
    resolve();
    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(false));
  });
  it('blocks absent workspaces', async () => {
    render(view('entry-1', null));
    await screen.findByRole('alert');
    expect(exportButton().disabled).toBe(true);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it('requires a fresh inspection after failed export', async () => {
    mocks.export.mockRejectedValueOnce('解析内容已变化，请重新检查');
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await screen.findByRole('alert');
    expect(exportButton().disabled).toBe(true);
    expect(mocks.close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
  });

  it('rechecks diagram options and carries the choice to the backend', async () => {
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '流程图导出方式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '原图 + 源码附录' }));
    await waitFor(() => expect(mocks.inspect).toHaveBeenLastCalledWith('C:/library', 'entry-1', 'source', { ...DEFAULT_EXPORT_OPTIONS, diagrams: 'original_with_source' }));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].options.diagrams).toBe('original_with_source');
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('renders only inspected diagrams before exporting', async () => {
    const diagrams = [{ id: 'diagram-1', segment_uid: 's1', page: 2, code: 'graph LR; A-->B' }];
    mocks.inspect.mockResolvedValue({ ...report, diagrams });
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '流程图导出方式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Mermaid 渲染图' }));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.render).toHaveBeenCalledWith(diagrams, expect.any(Function));
    expect(mocks.export.mock.calls[0][0].rendered_diagrams).toEqual([{ id: 'diagram-1', png_base64: 'png' }]);
  });

  it('stops without writing on a diagram rendering failure', async () => {
    mocks.render.mockRejectedValue(new Error('流程图无法渲染，请选择原图'));
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '流程图导出方式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Mermaid 渲染图' }));
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.click(exportButton());
    expect((await screen.findByRole('alert')).textContent).toContain('请选择原图');
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('switching to TXT replaces unsupported render mode with source', async () => {
    render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '流程图导出方式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Mermaid 渲染图' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '文件格式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: '纯文本 (.txt)' }));
    await waitFor(() => expect(mocks.inspect).toHaveBeenLastCalledWith('C:/library', 'entry-1', 'source', { ...DEFAULT_EXPORT_OPTIONS, diagrams: 'mermaid' }));
    expect(screen.getByRole('combobox', { name: '流程图导出方式' }).textContent).toContain('Mermaid 源码');
  });

  it('retains an expanded inspection during option rechecks without authorizing stale export', async () => {
    const issues = Array.from({ length: 60 }, (_, index) => ({ segment_uid: `s${index}`, page: index + 1, message: `图片待核对 ${index}` }));
    mocks.inspect.mockResolvedValueOnce({ ...report, issues, missing_assets: 60, requires_draft: true });
    let resolve!: (value: PaperExportInspection) => void;
    mocks.inspect.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(view());
    const summary = await screen.findByText('查看 60 项内容检查结果');
    fireEvent.click(summary);
    const details = summary.closest('details')!;
    await waitFor(() => expect(details.open).toBe(true));
    const body = screen.getByRole('region', { name: '导出选项和检查结果' });
    fireEvent.click(screen.getByRole('switch', { name: '显示逐段来源编号' }));
    await screen.findByText('正在重新检查，结果更新前不可导出…');
    expect(screen.getByText('查看 60 项内容检查结果').closest('details')).toBe(details);
    expect(details.open).toBe(true);
    expect(screen.getByText('第 60 页 · 图片待核对 59')).toBeTruthy();
    expect(screen.getByRole('region', { name: '导出选项和检查结果' })).toBe(body);
    expect(exportButton().disabled).toBe(true);
    expect(exportButton().textContent).toBe('继续导出（含待核对内容）');
    fireEvent.click(exportButton());
    expect(mocks.save).not.toHaveBeenCalled();
    resolve({ ...report, issues, missing_assets: 60, requires_draft: true, fingerprint: 'new-snapshot' });
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    expect(details.open).toBe(true);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0]).toMatchObject({ expected_fingerprint: 'new-snapshot', allow_draft: true });
  });

  it('invalidates the previous inspection when reopening the same entry', async () => {
    const { rerender } = render(view());
    await waitFor(() => expect(exportButton().disabled).toBe(false));
    const reopenView = (open: boolean) => <ToastContext.Provider value={{ notify: mocks.notify, dismiss: vi.fn() }}>
      <PaperExportDialog entryId="entry-1" entryTitle="研究论文" workspaceRoot="C:/library" open={open} onOpenChange={mocks.close} />
    </ToastContext.Provider>;
    rerender(reopenView(false));
    let resolve!: (value: PaperExportInspection) => void;
    mocks.inspect.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    rerender(reopenView(true));
    await screen.findByText('正在重新检查，结果更新前不可导出…');
    expect(exportButton().disabled).toBe(true);
    resolve({ ...report, fingerprint: 'reopened' });
    await waitFor(() => expect(exportButton().disabled).toBe(false));
  });

  it('does not show the previous entry inspection in a new context', async () => {
    mocks.inspect.mockResolvedValueOnce({ ...report, issues: [{ segment_uid: 's1', page: 1, message: '旧条目检查提示' }] });
    const { rerender } = render(view());
    await screen.findByText('查看 1 项内容检查结果');
    mocks.inspect.mockReturnValueOnce(new Promise(() => {}));
    rerender(view('entry-2'));
    expect(screen.queryByText('第 1 页 · 旧条目检查提示')).toBeNull();
    expect(screen.getByText('正在检查全部片段、译文与图片…')).toBeTruthy();
    expect(exportButton().disabled).toBe(true);
  });
});
