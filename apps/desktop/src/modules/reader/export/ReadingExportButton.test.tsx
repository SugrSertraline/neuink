// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import type { ReadingExportScope } from '@/shared/ipc/readingExportApi';
import { ReadingExportButton } from './ReadingExportButton';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), save: vi.fn(), export: vi.fn() }));
vi.mock('@/shared/ipc/readingExportApi', () => ({ inspectReadingExport: mocks.inspect, exportReading: mocks.export }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
const report = { entry_title: '论文', scope_applied: true, items: [{ id: 'annotation:a1', kind: 'annotation', title: '批注甲', preview: '快照正文', page: 1, note_id: null, fingerprint: 'v1', warnings: [] }] };
function view(scope: ReadingExportScope, preselectScope = false, entryId = 'e1') {
  return <ToastContext.Provider value={{ notify: vi.fn(), dismiss: vi.fn() }}>
    <ReadingExportButton entryId={entryId} entryTitle="论文" workspaceRoot="C:/library" scope={scope} scopeLabel="导出当前片段批注" preselectScope={preselectScope} />
  </ToastContext.Provider>;
}
beforeEach(() => { vi.resetAllMocks(); mocks.inspect.mockResolvedValue(report); mocks.save.mockResolvedValue('C:/exports/result.zip'); });
afterEach(cleanup);

describe('ReadingExportButton context', () => {
  it('captures the clicked scope, preselects explicit current records and exports only their fingerprints', async () => {
    const scope: ReadingExportScope = { kinds: ['annotation'], item_ids: ['annotation:a1'] };
    const { rerender } = render(view(scope, true));
    fireEvent.click(screen.getByRole('button', { name: '导出当前片段批注' }));
    await screen.findByText('快照正文');
    expect(mocks.inspect).toHaveBeenCalledWith('C:/library', 'e1', undefined, scope);
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    rerender(view({ kinds: ['annotation'] }, true));
    expect(mocks.inspect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '选择位置并导出' }));
    await waitFor(() => expect(mocks.export).toHaveBeenCalled());
    expect(mocks.export.mock.calls[0][0].selected).toEqual([{ id: 'annotation:a1', fingerprint: 'v1' }]);
  });
  it('does not preselect all records for a page-level export', async () => {
    render(view({ kinds: ['segment_note', 'annotation'] }));
    fireEvent.click(screen.getByRole('button', { name: '导出当前片段批注' }));
    await screen.findByText('快照正文');
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '选择位置并导出' }).disabled).toBe(true);
  });
  it('blocks old desktop backends that cannot acknowledge scoped inspection', async () => {
    mocks.inspect.mockResolvedValue({ ...report, scope_applied: undefined });
    render(view({ kinds: ['annotation'] }, true));
    fireEvent.click(screen.getByRole('button', { name: '导出当前片段批注' }));
    expect((await screen.findByRole('alert')).textContent).toContain('桌面后端尚未更新');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it('closes the captured context on entry changes and does not reopen it when switching back', async () => {
    const scope: ReadingExportScope = { kinds: ['annotation'] };
    const { rerender } = render(view(scope));
    fireEvent.click(screen.getByRole('button', { name: '导出当前片段批注' }));
    await screen.findByText('快照正文');
    rerender(view(scope, false, 'e2'));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view(scope));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('returns keyboard focus to the contextual entrance after cancel', async () => {
    render(view({ kinds: ['annotation'] }));
    const button = screen.getByRole('button', { name: '导出当前片段批注' });
    button.focus();
    fireEvent.click(button);
    await screen.findByText('快照正文');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
