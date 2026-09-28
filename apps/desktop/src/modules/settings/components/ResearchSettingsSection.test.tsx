// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchSettingsSection } from './ResearchSettingsSection';
import { getResearchSettings, saveResearchSettings } from '@/shared/ipc/researchApi';
import { hasUnsavedSegmentEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
vi.mock('@/shared/ipc/researchApi', () => ({ getResearchSettings: vi.fn(), saveResearchSettings: vi.fn() }));
const initial = { papers_enabled: true, web_enabled: true, has_web_key: false, use_tavily: false };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getResearchSettings).mockResolvedValue(initial); });
afterEach(cleanup);
describe('research service settings', () => {
  it('loads only when visible and never enables a paid provider implicitly', async () => {
    const view = render(<ResearchSettingsSection active={false} />);
    expect(getResearchSettings).not.toHaveBeenCalled();
    view.rerender(<ResearchSettingsSection active />);
    const web = await view.findByRole('switch', { name: '网页搜索与正文提取' });
    expect((web as HTMLButtonElement).disabled).toBe(false); expect(saveResearchSettings).not.toHaveBeenCalled();
    expect(web.getAttribute('aria-checked')).toBe('true');
    vi.mocked(saveResearchSettings).mockResolvedValue({ ...initial, papers_enabled: false });
    fireEvent.click(view.getByRole('switch', { name: '论文检索与 PDF 导入' }));
    await waitFor(() => expect(saveResearchSettings).toHaveBeenCalledWith({ papers_enabled: false, web_enabled: true, use_tavily: false }));
  });
  it('keeps failed credentials as an unsaved draft, then clears them after a verified save', async () => {
    const view = render(<ResearchSettingsSection active />);
    const input = await view.findByLabelText('Tavily API Key（未配置）');
    fireEvent.click(view.getByText('Tavily'));
    fireEvent.change(input, { target: { value: 'test-secret' } });
    expect(hasUnsavedSegmentEditors('settings')).toBe(true);
    vi.mocked(saveResearchSettings).mockRejectedValueOnce('系统凭据库不可用');
    fireEvent.click(view.getByText('保存密钥'));
    await view.findByRole('alert');
    expect((input as HTMLInputElement).value).toBe('test-secret');
    vi.mocked(saveResearchSettings).mockResolvedValue({ ...initial, has_web_key: true });
    fireEvent.click(view.getByText('保存密钥'));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    expect(view.queryByText('test-secret')).toBeNull();
    expect(saveResearchSettings).toHaveBeenLastCalledWith({ papers_enabled: true, web_enabled: true, use_tavily: false, web_key: 'test-secret' });
    view.unmount(); expect(hasUnsavedSegmentEditors('settings')).toBe(false);
  });
  it('provides explicit retry after load failure', async () => {
    vi.mocked(getResearchSettings).mockRejectedValueOnce('读取失败');
    const view = render(<ResearchSettingsSection active />);
    await view.findByRole('alert');
    fireEvent.click(view.getByText('重新读取检索设置'));
    await view.findByRole('switch', { name: '论文检索与 PDF 导入' });
    expect(getResearchSettings).toHaveBeenCalledTimes(2);
  });
  it('allows keyless web opt-out and opt-in without collecting a credential', async () => {
    const view = render(<ResearchSettingsSection active />);
    const web = await view.findByRole('switch', { name: '网页搜索与正文提取' });
    vi.mocked(saveResearchSettings).mockResolvedValueOnce({ ...initial, web_enabled: false });
    fireEvent.click(web);
    await waitFor(() => expect(web.getAttribute('aria-checked')).toBe('false'));
    vi.mocked(saveResearchSettings).mockResolvedValueOnce(initial);
    fireEvent.click(web);
    await waitFor(() => expect(web.getAttribute('aria-checked')).toBe('true'));
    expect(saveResearchSettings).toHaveBeenLastCalledWith({ papers_enabled: true, web_enabled: true, use_tavily: false });
  });
  it('only uses a saved optional key after explicit selection', async () => {
    vi.mocked(getResearchSettings).mockResolvedValue({ ...initial, has_web_key: true });
    const view = render(<ResearchSettingsSection active />);
    await view.findByText('Tavily');
    fireEvent.click(view.getByText('Tavily'));
    const option = view.getByRole('switch', { name: '使用 Tavily 替代免费网页服务' });
    expect(saveResearchSettings).not.toHaveBeenCalled();
    vi.mocked(saveResearchSettings).mockResolvedValue({ ...initial, has_web_key: true, use_tavily: true });
    fireEvent.click(option);
    await waitFor(() => expect(option.getAttribute('aria-checked')).toBe('true'));
    expect(saveResearchSettings).toHaveBeenCalledWith({ papers_enabled: true, web_enabled: true, use_tavily: true });
  });
  it('can return to free search even when an enabled Tavily key has disappeared', async () => {
    vi.mocked(getResearchSettings).mockResolvedValue({ ...initial, use_tavily: true });
    const view = render(<ResearchSettingsSection active />);
    await view.findByText('Tavily');
    fireEvent.click(view.getByText('Tavily'));
    const option = view.getByRole('switch', { name: '使用 Tavily 替代免费网页服务' });
    expect((option as HTMLButtonElement).disabled).toBe(false);
    vi.mocked(saveResearchSettings).mockResolvedValue(initial);
    fireEvent.click(option);
    await waitFor(() => expect(option.getAttribute('aria-checked')).toBe('false'));
    expect(saveResearchSettings).toHaveBeenCalledWith({ papers_enabled: true, web_enabled: true, use_tavily: false });
  });
});
