// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import type { PaperExportInspection, PaperExportPreview } from '@/shared/ipc/exportApi';
import { PaperExportDialog } from './PaperExportDialog';
import { DEFAULT_EXPORT_OPTIONS } from './PaperExportOptionsFields';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), preview: vi.fn(), export: vi.fn(), save: vi.fn(), close: vi.fn(), render: vi.fn() }));
vi.mock('@/shared/ipc/exportApi', () => ({ inspectPaperExport: mocks.inspect, previewPaperExport: mocks.preview, exportPaper: mocks.export }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('./renderExportDiagrams', () => ({ renderExportDiagrams: mocks.render }));
vi.mock('@/shared/components/MermaidDiagramPreview', () => ({ MermaidDiagramPreview: () => <div>流程图</div> }));
const report: PaperExportInspection = {
  fingerprint: 'inspected', total: 2, translated: 1, preserved: 1, missing: 0, stale: 0,
  unverified_images: 2, missing_assets: 0, requires_draft: false, diagrams: [],
  issues: [{ segment_uid: 's1', page: 2, message: '图片中的文字未核验' }, { segment_uid: 's2', page: 5, message: '表格中的图片未核验' }]
};
const preview: PaperExportPreview = {
  fingerprint: report.fingerprint, segment_uid: 's1', page: 2,
  markdown: '图注保留\n\n![论文原图](assets/figure.png)',
  assets: { 'assets/figure.png': 'data:image/png;base64,test' }, diagrams: []
};
function view(entryId = 'entry-1') {
  return <ToastContext.Provider value={{ notify: vi.fn(), dismiss: vi.fn() }}>
    <PaperExportDialog entryId={entryId} entryTitle="预览测试" workspaceRoot="C:/library" open onOpenChange={mocks.close} />
  </ToastContext.Provider>;
}
async function openPreview() {
  const summary = await screen.findByText('查看 2 项内容检查结果');
  fireEvent.click(summary);
  const trigger = screen.getByRole('button', { name: '预览第 2 页的第 1 项检查内容' });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, details: summary.closest('details')! };
}
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.inspect.mockResolvedValue(report);
  mocks.preview.mockResolvedValue(preview);
  mocks.render.mockResolvedValue([{ id: 'diagram-1', png_base64: 'rendered' }]);
});
afterEach(cleanup);

describe('paper export inspection preview', () => {
  it('loads only on click, opens an image, and returns to the expanded inspection with focus', async () => {
    render(view());
    await screen.findByText('查看 2 项内容检查结果');
    expect(mocks.preview).not.toHaveBeenCalled();
    const { trigger, details } = await openPreview();
    await screen.findByText('图注保留');
    expect(mocks.preview).toHaveBeenCalledWith({ root: 'C:/library', entry_id: 'entry-1', kind: 'source',
      options: DEFAULT_EXPORT_OPTIONS, expected_fingerprint: 'inspected', segment_uid: 's1' });
    expect(screen.getByRole('img').getAttribute('src')).toBe(preview.assets['assets/figure.png']);
    fireEvent.click(screen.getByRole('button', { name: '查看论文原图详情' }));
    expect(screen.getByRole('dialog', { name: '图片详情' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭大图' }));
    const dialog = screen.getByRole('dialog', { name: '检查内容预览' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '检查内容预览' })).toBeNull());
    expect(screen.getByRole('dialog', { name: '导出论文内容' })).toBeTruthy();
    expect(details.open).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.export).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('ignores late previews after quickly navigating to another item', async () => {
    let first!: (value: PaperExportPreview) => void;
    let second!: (value: PaperExportPreview) => void;
    mocks.preview.mockReturnValueOnce(new Promise(resolve => { first = resolve; }));
    mocks.preview.mockReturnValueOnce(new Promise(resolve => { second = resolve; }));
    render(view());
    await openPreview();
    expect(screen.getByText('正在读取对应内容…')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '上一项' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '下一项' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一项' }).disabled).toBe(true);
    second({ ...preview, segment_uid: 's2', page: 5, markdown: '当前片段 B', assets: {} });
    await screen.findByText('当前片段 B');
    first({ ...preview, markdown: '迟到片段 A' });
    await waitFor(() => expect(screen.queryByText('迟到片段 A')).toBeNull());
    expect(screen.getByText('第 5 页 · 第 2 / 2 项')).toBeTruthy();
  });

  it('supports preview failures and retry without changing export permissions', async () => {
    mocks.preview.mockRejectedValueOnce('暂时无法读取内容');
    render(view());
    await openPreview();
    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法读取内容');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    await screen.findByText('图注保留');
    expect(mocks.preview).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '返回检查清单' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '选择位置并导出' }).disabled).toBe(false);
    expect(mocks.export).not.toHaveBeenCalled();
  });

  it('rejects a mismatched preview and can recheck the parent inspection', async () => {
    mocks.preview.mockResolvedValueOnce({ ...preview, fingerprint: 'changed', markdown: '不能展示的旧内容' });
    render(view());
    await openPreview();
    await screen.findByText('预览与当前检查结果不一致，请重新检查内容。');
    expect(screen.queryByText('不能展示的旧内容')).toBeNull();
    mocks.inspect.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: '重新检查内容' }));
    await screen.findByText('正在重新检查，结果更新前不可导出…');
    expect(screen.queryByRole('dialog', { name: '检查内容预览' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '选择位置并导出' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '预览第 2 页的第 1 项检查内容' }).disabled).toBe(true);
  });

  it('closes and discards a late preview when switching entries', async () => {
    let resolve!: (value: PaperExportPreview) => void;
    mocks.preview.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { rerender } = render(view());
    await openPreview();
    rerender(view('entry-2'));
    resolve({ ...preview, markdown: '上一个条目的内容' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '检查内容预览' })).toBeNull());
    expect(screen.queryByText('上一个条目的内容')).toBeNull();
  });

  it('renders tables with a bounded full-table viewer and marks unavailable images', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => `| 结果 ${i} | ${i} |`).join('\n');
    mocks.preview.mockResolvedValueOnce({ ...preview, assets: {}, markdown: `| 指标 | 值 |\n| --- | --- |\n${rows}\n\n![缺图](missing-asset)` });
    render(view());
    await openPreview();
    await screen.findByText('81 行 · 2 列');
    expect(screen.getByText('图片缺失或不可用，无法预览。')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看大表' }));
    const tableDialog = screen.getByRole('dialog', { name: '表格详情' });
    expect(within(tableDialog).getAllByRole('row')).toHaveLength(81);
    fireEvent.click(within(tableDialog).getByRole('button', { name: '关闭大表' }));
    expect(screen.getByRole('dialog', { name: '检查内容预览' })).toBeTruthy();
  });

  it('shows an explicit empty preview', async () => {
    mocks.preview.mockResolvedValueOnce({ ...preview, markdown: '', assets: {} });
    render(view());
    await openPreview();
    await screen.findByText('此片段没有可预览的正文或图片，请参考上方检查说明。');
  });

  it('uses the existing renderer for only this preview item’s diagrams', async () => {
    const diagrams = [{ id: 'diagram-1', segment_uid: 's1', page: 2, code: 'graph LR; A-->B' }];
    mocks.preview.mockResolvedValueOnce({ ...preview, markdown: '![重绘图](diagrams/diagram-1.png)', assets: {}, diagrams });
    render(view());
    await openPreview();
    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toBe('data:image/png;base64,rendered');
    expect(mocks.render).toHaveBeenCalledWith(diagrams, expect.any(Function));
    expect(mocks.export).not.toHaveBeenCalled();
  });
});
