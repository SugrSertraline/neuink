// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import {
  approveResearchImport, approveSelectedImport, getResearchSettings, previewResearchImport,
  previewSelectedImport, runResearchTool, type PaperCacheSource, type ResearchPaper,
} from '@/shared/ipc/researchApi';
import {
  PAPER_DOWNLOAD_CONFIRMATION_KEY, readPaperDownloadConfirmation, setPaperDownloadConfirmation,
} from '@/shared/lib/paperDownloadPreferences';
import { ResearchSettingsSection } from '@/modules/settings/components/ResearchSettingsSection';
import { ResearchPaperAction, ResearchPaperActionsProvider } from './ResearchPaperActions';
import { getAssistantBackgroundRuns, setAssistantBackgroundRun, stopAssistantBackgroundRun } from './assistantBackgroundRuns';
import { ToolApprovalPanel } from './ToolApprovalPanel';
import { decideToolApproval, getToolApprovals, requestToolApproval } from '../runtime/toolApproval';

vi.mock('@/shared/ipc/researchApi', async original => ({
  ...await original<typeof import('@/shared/ipc/researchApi')>(),
  previewResearchImport: vi.fn(), previewSelectedImport: vi.fn(),
  approveResearchImport: vi.fn(), approveSelectedImport: vi.fn(), runResearchTool: vi.fn(),
  getResearchSettings: vi.fn(), saveResearchSettings: vi.fn(),
}));
const first: ResearchPaper = { id: 'arxiv:1706.03762v1', title: 'First paper', authors: ['A'], year: '2017',
  doi: '', url: 'https://arxiv.org/abs/1706.03762v1', pdf_url: 'https://arxiv.org/pdf/1706.03762v1',
  abstract_text: 'Public abstract', provider: 'arxiv', evidence_level: 'abstract' };
const second = { ...first, id: 'arxiv:1810.04805v1', title: 'Second paper' };
beforeEach(() => {
  window.localStorage.clear(); vi.resetAllMocks();
  vi.mocked(getResearchSettings).mockResolvedValue({ papers_enabled: true, web_enabled: true, use_tavily: false, has_web_key: false });
  vi.mocked(previewResearchImport).mockImplementation(async (_root, ids) => [first, second].filter(p => ids.includes(p.id)));
  vi.mocked(previewSelectedImport).mockImplementation(async (_root, selections) => [first, second].filter(p => selections.some(s => s.paperId === p.id)));
  vi.mocked(approveResearchImport).mockResolvedValue(); vi.mocked(approveSelectedImport).mockResolvedValue();
  vi.mocked(runResearchTool).mockImplementation(async (_name, input) => ({
    results: (input.paper_ids as string[]).map(id => ({ id, status: 'imported' })),
  }));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); setAssistantBackgroundRun(null);
  getToolApprovals().forEach(item => decideToolApproval(item.id, false));
});
function ui(source: PaperCacheSource = 'research', copies = 1) {
  return render(<ToastContext.Provider value={{ notify: () => '', dismiss: () => {} }}>
    <ResearchPaperActionsProvider root="download-fixture">
      {Array.from({ length: copies }, (_, i) => <section key={i} aria-label={`copy-${i}`}>
        <ResearchPaperAction paper={first} cacheSource={source} />
      </section>)}
      <section aria-label="second"><ResearchPaperAction paper={second} cacheSource={source} /></section>
      <ResearchSettingsSection active />
    </ResearchPaperActionsProvider>
  </ToastContext.Provider>);
}
it('defaults to confirmation, synchronizes both controls and only skips confirmation on the next click', async () => {
  const view = ui();
  fireEvent.click(within(view.getByRole('region', { name: 'copy-0' })).getByRole('button', { name: '添加到本地' }));
  const checkbox = await view.findByRole('checkbox', { name: '下次下载论文时不再确认' });
  const setting = view.getByRole('switch', { name: '下载论文前确认' });
  expect(setting.getAttribute('aria-checked')).toBe('true');
  expect(view.getByText('可在设置中重新开启下载确认。')).toBeTruthy();
  fireEvent.click(checkbox);
  expect(setting.getAttribute('aria-checked')).toBe('false');
  expect(runResearchTool).not.toHaveBeenCalled(); expect(approveResearchImport).not.toHaveBeenCalled();
  fireEvent.click(within(view.getByRole('region', { name: 'second' })).getByRole('button', { name: '添加到本地' }));
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(1));
  expect(vi.mocked(runResearchTool).mock.calls[0][1].paper_ids).toEqual([second.id]);
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(2));
  fireEvent.click(setting);
  expect(setting.getAttribute('aria-checked')).toBe('true');
  view.unmount();
  const reopened = ui();
  expect(reopened.getByRole('switch', { name: '下载论文前确认' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(reopened.getByRole('region', { name: 'copy-0' })).getByRole('button', { name: '添加到本地' }));
  await reopened.findByRole('button', { name: '确认添加' });
  expect(runResearchTool).toHaveBeenCalledTimes(2);
});
it.each<PaperCacheSource>(['research', 'arxiv_search'])('keeps fresh preview, source-bound approval and duplicate protection when skipping %s confirmation', async source => {
  setPaperDownloadConfirmation(false);
  let finish!: (papers: ResearchPaper[]) => void;
  const preview = source === 'research' ? vi.mocked(previewResearchImport) : vi.mocked(previewSelectedImport);
  preview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui(source, 2);
  const buttons = view.getAllByRole('button', { name: '添加到本地' });
  fireEvent.click(buttons[0]); fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
  expect(preview).toHaveBeenCalledTimes(1);
  await act(async () => finish([first]));
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(1));
  if (source === 'research') {
    expect(approveResearchImport).toHaveBeenCalledExactlyOnceWith('download-fixture', [first.id], [first], expect.any(String));
    expect(approveSelectedImport).not.toHaveBeenCalled();
  } else {
    expect(approveSelectedImport).toHaveBeenCalledExactlyOnceWith('download-fixture', [{ paperId: first.id, cacheSource: source }], [first], expect.any(String));
    expect(approveResearchImport).not.toHaveBeenCalled();
  }
  expect(view.queryByRole('button', { name: '确认添加' })).toBeNull();
});
it('preserves a disabled confirmation preference across remount and accepts storage events from another window', async () => {
  const view = ui();
  fireEvent.click(view.getByRole('switch', { name: '下载论文前确认' }));
  view.unmount();
  const reopened = ui();
  expect(reopened.getByRole('switch', { name: '下载论文前确认' }).getAttribute('aria-checked')).toBe('false');
  act(() => {
    window.localStorage.setItem(PAPER_DOWNLOAD_CONFIRMATION_KEY, 'true');
    window.dispatchEvent(new StorageEvent('storage', { key: PAPER_DOWNLOAD_CONFIRMATION_KEY }));
  });
  expect(reopened.getByRole('switch', { name: '下载论文前确认' }).getAttribute('aria-checked')).toBe('true');
});
it('does not turn an already requested preview into an automatic download when settings change', async () => {
  let finish!: (papers: ResearchPaper[]) => void;
  vi.mocked(previewResearchImport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui();
  fireEvent.click(view.getAllByRole('button', { name: '添加到本地' })[0]);
  fireEvent.click(view.getByRole('switch', { name: '下载论文前确认' }));
  await act(async () => finish([first]));
  await view.findByRole('button', { name: '确认添加' });
  expect(runResearchTool).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '取消' }));
  expect(approveResearchImport).not.toHaveBeenCalled();
});
it('does not grant an automatic import after closing the view while preview is pending', async () => {
  setPaperDownloadConfirmation(false);
  let finish!: (papers: ResearchPaper[]) => void;
  vi.mocked(previewResearchImport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui(); fireEvent.click(view.getAllByRole('button', { name: '添加到本地' })[0]); view.unmount();
  await act(async () => finish([first]));
  expect(approveResearchImport).not.toHaveBeenCalled(); expect(runResearchTool).not.toHaveBeenCalled();
});
it('retains stop handling while automatically approving a fresh user click', async () => {
  setPaperDownloadConfirmation(false);
  let finish!: () => void;
  vi.mocked(approveResearchImport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui(); fireEvent.click(view.getAllByRole('button', { name: '添加到本地' })[0]);
  await waitFor(() => expect(getAssistantBackgroundRuns()).toHaveLength(1));
  act(() => stopAssistantBackgroundRun(getAssistantBackgroundRuns()[0].abortController));
  await act(async () => finish());
  expect(runResearchTool).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain('已停止');
});
it('uses a fresh preview and grant when retrying a failed download without visible confirmation', async () => {
  setPaperDownloadConfirmation(false);
  vi.mocked(runResearchTool).mockResolvedValueOnce({ results: [{ id: first.id, status: 'failed', error: 'HTTP 503' }] });
  const view = ui(); fireEvent.click(view.getAllByRole('button', { name: '添加到本地' })[0]);
  await view.findByRole('alert');
  fireEvent.click(view.getByRole('button', { name: '重试添加' }));
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(2));
  expect(previewResearchImport).toHaveBeenCalledTimes(2); expect(approveResearchImport).toHaveBeenCalledTimes(2);
  expect(vi.mocked(approveResearchImport).mock.calls[0][3]).not.toBe(vi.mocked(approveResearchImport).mock.calls[1][3]);
});
it('keeps confirmation enabled and reports failure when persistence is unavailable', async () => {
  const view = ui();
  const store = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  fireEvent.click(view.getByRole('switch', { name: '下载论文前确认' }));
  expect(view.getByRole('alert').textContent).toContain('未能保存');
  expect(view.getByRole('switch', { name: '下载论文前确认' }).getAttribute('aria-checked')).toBe('true');
  store.mockRestore();
  fireEvent.click(view.getAllByRole('button', { name: '添加到本地' })[0]);
  await view.findByRole('button', { name: '确认添加' });
  const checkboxStore = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  fireEvent.click(view.getByRole('checkbox', { name: '下次下载论文时不再确认' }));
  expect(view.getAllByRole('alert').some(item => item.textContent?.includes('本次仍需确认'))).toBe(true);
  expect(runResearchTool).not.toHaveBeenCalled(); checkboxStore.mockRestore();
  expect(readPaperDownloadConfirmation()).toBe(true);
});
it('still requires model-initiated approval after the user disables click confirmation', async () => {
  setPaperDownloadConfirmation(false);
  const promise = requestToolApproval('download-fixture', 'chat')({
    toolName: 'import_papers', toolCallId: 'model-import', input: { paper_ids: [first.id] },
  });
  const view = render(<ToolApprovalPanel root="download-fixture" conversationId="chat" onOpen={() => {}} />);
  await view.findByRole('button', { name: '确认下载 1 篇' });
  expect(approveResearchImport).not.toHaveBeenCalled();
  expect(view.queryByRole('checkbox', { name: '下次下载论文时不再确认' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '拒绝并停止' }));
  await expect(promise).resolves.toBe(false);
});
