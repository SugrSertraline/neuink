// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
const mocks = vi.hoisted(() => ({ run: vi.fn(), report: vi.fn(() => 'safe report'), openLogs: vi.fn() }));
vi.mock('@/shared/ipc/translationLogApi', () => ({ openTranslationLogs: mocks.openLogs }));
vi.mock('../modelConnectionDiagnostics', async original => ({ ...await original<typeof import('../modelConnectionDiagnostics')>(), runModelDiagnostics: mocks.run, diagnosticReport: mocks.report }));
import { ModelConnectionTestDialog } from './ModelConnectionTestDialog';
const profile = { id: 'p', name: 'test', model: 'test-model' } as LlmProfile;
const success = [{ label: '选中文字翻译', status: 'success', message: '中文译文通过', code: 'OK' }, { label: '片段与批量翻译', status: 'success', message: '结构化译文通过', code: 'OK' }];
beforeEach(() => { vi.clearAllMocks(); mocks.run.mockImplementation(async (_profile, _signal, update) => { update(success); return success; }); });
afterEach(cleanup);
it('runs once under StrictMode, shows both results and copies a safe diagnostic report', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const onResult = vi.fn();
  render(<StrictMode><ModelConnectionTestDialog profile={profile} onClose={vi.fn()} onResult={onResult} /></StrictMode>);
  await screen.findByText('结构化译文通过'); expect(mocks.run).toHaveBeenCalledOnce();
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  fireEvent.click(screen.getByText('复制诊断信息'));
  await screen.findByText('诊断信息已复制。'); expect(writeText).toHaveBeenCalledWith('safe report');
});
it('cancels, retries, and aborts on unmount without applying a late result', async () => {
  mocks.run.mockImplementation((_profile, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
  const onResult = vi.fn(); const view = render(<ModelConnectionTestDialog profile={profile} onClose={vi.fn()} onResult={onResult} />);
  await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText('取消测试')); await screen.findByText('重新测试');
  expect(mocks.run.mock.calls[0][1].aborted).toBe(true);
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }));
  fireEvent.click(screen.getByText('重新测试')); await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
  onResult.mockClear(); view.unmount(); await act(async () => {});
  expect(mocks.run.mock.calls[1][1].aborted).toBe(true); expect(onResult).not.toHaveBeenCalled();
});
it('shows failure guidance, supports retry and reports clipboard failure', async () => {
  const failed = [{ ...success[0], status: 'error', code: 'HTTP_401', message: '请检查密钥' }, success[1]];
  mocks.run.mockImplementationOnce(async (_profile, _signal, update) => { update(failed); return failed; });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error()) } });
  const onResult = vi.fn(); render(<ModelConnectionTestDialog profile={profile} onClose={vi.fn()} onResult={onResult} />);
  await screen.findByText('请检查密钥'); expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  fireEvent.click(screen.getByText('复制诊断信息')); await screen.findByText('复制失败，请重试。');
  fireEvent.click(screen.getByText('重新测试')); await screen.findByText('中文译文通过');
});
it('offers the local error log directory and shows a failure if it cannot open', async () => {
  mocks.openLogs.mockRejectedValue(new Error('private path'));
  render(<ModelConnectionTestDialog profile={profile} onClose={vi.fn()} onResult={vi.fn()} />);
  await screen.findByText('中文译文通过');
  fireEvent.click(screen.getByText('打开错误日志'));
  await screen.findByText('无法打开日志目录，请检查数据目录权限。');
  expect(mocks.openLogs).toHaveBeenCalledOnce();
});
