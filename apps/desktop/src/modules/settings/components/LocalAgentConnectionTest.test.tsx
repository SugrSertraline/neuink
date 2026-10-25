// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalAgentConnectionTest } from './LocalAgentConnectionTest';
import { testLocalAgentConnection } from '@/shared/ipc/localAgentApi';
vi.mock('@/shared/ipc/localAgentApi', () => ({ testLocalAgentConnection: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('explicit local Agent model and MCP connection test', () => {
  it('does not contact a model automatically and only enables installed tools', () => {
    const view = render(<LocalAgentConnectionTest provider="claude" available={false} />);
    const button = screen.getByRole('button', { name: '测试 Claude Code 连接' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(testLocalAgentConnection).not.toHaveBeenCalled();
    view.rerender(<LocalAgentConnectionTest provider="claude" available />);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(testLocalAgentConnection).not.toHaveBeenCalled();
  });
  it('shows the actual result, blocks duplicate clicks, and ignores cancelled late success', async () => {
    let finish!: () => void;
    vi.mocked(testLocalAgentConnection).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<LocalAgentConnectionTest provider="codex" available />);
    const button = screen.getByRole('button', { name: '测试 Codex 连接' });
    fireEvent.click(button); fireEvent.click(button);
    expect(testLocalAgentConnection).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('正在验证');
    fireEvent.click(screen.getByRole('button', { name: '取消测试' }));
    expect(vi.mocked(testLocalAgentConnection).mock.calls[0][1].aborted).toBe(true);
    finish();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('连接测试已取消。'));
    vi.mocked(testLocalAgentConnection).mockResolvedValue(undefined);
    fireEvent.click(button);
    await screen.findByText('模型响应和 NeuInk 工具连接正常。');
  });
  it('cleans up a hidden or unmounted row and removes stale connection status', async () => {
    let finish!: () => void;
    vi.mocked(testLocalAgentConnection).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<LocalAgentConnectionTest provider="claude" available />);
    fireEvent.click(screen.getByRole('button'));
    view.rerender(<LocalAgentConnectionTest provider="claude" available={false} />);
    expect(vi.mocked(testLocalAgentConnection).mock.calls[0][1].aborted).toBe(true);
    finish(); await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    view.rerender(<LocalAgentConnectionTest provider="claude" available />);
    fireEvent.click(screen.getByRole('button'));
    view.unmount();
    expect(vi.mocked(testLocalAgentConnection).mock.calls[1][1].aborted).toBe(true);
    finish();
  });
  it('classifies connection errors without showing raw details and supports retry', async () => {
    vi.mocked(testLocalAgentConnection).mockRejectedValueOnce('Codex 服务连接失败，请检查网络和本机服务配置后重试。')
      .mockRejectedValueOnce('secret-token and private-path');
    render(<LocalAgentConnectionTest provider="codex" available />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('Codex 服务连接失败，请检查网络和本机服务配置后重试。');
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('连接测试失败，请检查本机登录、模型和网络配置后重试。');
    expect(screen.queryByText(/secret-token/)).toBeNull();
  });
});
