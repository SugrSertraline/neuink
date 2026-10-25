// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAgentSettingsSection } from './LocalAgentSettingsSection';
import { detectLocalAgent, type LocalAgentDetection } from '@/shared/ipc/localAgentApi';

vi.mock('@/shared/ipc/localAgentApi', () => ({ detectLocalAgent: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.mocked(detectLocalAgent).mockReset(); });
afterEach(cleanup);

describe('local agent settings', () => {
  it('keeps independently available agents usable when another probe fails',async()=>{
    vi.mocked(detectLocalAgent).mockImplementation(async provider=>{
      if(provider==='claude') throw new Error('secret-path');
      return {status:provider==='codex'?'detected':'missing',message:provider==='codex'?'已检测到 Codex':'未检测到 OpenCode，请安装后重新检测。'};
    });
    render(<LocalAgentSettingsSection active/>);fireEvent.click(screen.getByRole('switch'));
    await screen.findByText('已检测到 Codex');await screen.findByText('无法检测 Claude Code，请重试。');
    expect(screen.getByText('OpenCode')).toBeTruthy();expect(screen.queryByText('secret-path')).toBeNull();
  });
  it('only detects after opt-in and keeps fields flat without a path input', async () => {
    vi.mocked(detectLocalAgent).mockImplementation(async provider => ({ status: 'detected', message: `已检测到 ${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'OpenCode'}` }));
    const { container } = render(<LocalAgentSettingsSection active />);
    expect(detectLocalAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('switch', { name: '启用本地 Agent' }));
    await screen.findByText('已检测到 Claude Code');
    expect(localStorage.getItem('neuink.localAgent.enabled')).toBe('true');
    expect(container.querySelector('details')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
    await waitFor(() => expect(detectLocalAgent).toHaveBeenCalledTimes(6));
  });

  it('ignores a late detection after disabling and does not detect on inactive pages', async () => {
    let resolve!: (value: LocalAgentDetection) => void;
    vi.mocked(detectLocalAgent).mockImplementation(provider => provider === 'claude' ? new Promise(done => { resolve = done; }) : Promise.resolve({status:'missing',message:'未安装'}));
    const view = render(<LocalAgentSettingsSection active={false} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(detectLocalAgent).not.toHaveBeenCalled();
    view.rerender(<LocalAgentSettingsSection active />);
    await waitFor(() => expect(detectLocalAgent).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('switch'));
    resolve({ status: 'detected', message: '已检测到 Claude Code' });
    await waitFor(() => expect(screen.queryByText('已检测到 Claude Code')).toBeNull());
    expect(localStorage.getItem('neuink.localAgent.enabled')).toBe('false');
  });

  it('shows detection failures and can retry without leaking raw errors', async () => {
    let attempts=0;
    vi.mocked(detectLocalAgent).mockImplementation(async provider => {
      if(provider !== 'claude') return {status:'missing',message:'未安装'};
      if(attempts++ === 0) throw new Error('private path');
      return {status:'missing',message:'未检测到 Claude Code。安装后点击重新检测。'};
    });
    render(<LocalAgentSettingsSection active />);
    fireEvent.click(screen.getByRole('switch'));
    await screen.findByText('无法检测 Claude Code，请重试。');
    expect(screen.queryByText('private path')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
    await screen.findByText('未检测到 Claude Code。安装后点击重新检测。');
  });
});
