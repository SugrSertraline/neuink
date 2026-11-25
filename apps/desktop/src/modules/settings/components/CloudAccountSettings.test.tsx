// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudAccountSettings } from './CloudAccountSettings';
import { cloudServerAddress } from './cloudServerAddress';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: call }));
vi.mock('./SettingsPrimitives', () => ({ SettingsGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section> }));
vi.mock('./CloudProfileSettings', () => ({ CloudProfileSettings: () => null }));
vi.mock('./CloudSyncControls', () => ({ CloudSyncControls: () => null }));
const account = { endpoint: 'https://10.0.0.1:18793/', server_id: 'saved-server', account_id: null, username: null };
afterEach(cleanup);
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); call.mockReset(); let saved = false; call.mockImplementation(async (request: { action: string }) => { if (request.action === 'connect') saved = true; return request.action === 'status' && !saved ? { ...account, endpoint: '', server_id: '' } : account; }); });
async function connect() {
  await waitFor(() => expect(screen.getByRole('button', { name: '连接服务器' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  await screen.findByRole('button', { name: '登录' });
}
it('does not contact account storage while inactive', () => {
  render(<CloudAccountSettings active={false} />);
  expect(call).not.toHaveBeenCalled();
});
it('does not request a password again for a saved login', async () => {
  call.mockResolvedValue({ ...account, account_id: 'user-1', username: 'alice' });
  render(<CloudAccountSettings active />);
  await screen.findByRole('button', { name: '退出账号' });
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(call.mock.calls.every(([request]) => request.action !== 'login')).toBe(true);
});
it('automatically reconnects a saved server and keeps the form behind change', async () => {
  call.mockResolvedValue(account);
  render(<CloudAccountSettings active />);
  await screen.findByRole('button', { name: '登录' });
  expect(call).toHaveBeenCalledWith({ action: 'connect', endpoint: account.endpoint });
  expect(screen.queryByLabelText('服务器 IP 或地址')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更改' }));
  expect(screen.getByRole('dialog', { name: '服务器设置' })).toBeTruthy();
  expect(screen.getByLabelText('服务器地址')).toHaveProperty('value', account.endpoint);
});
it('lets the user retry a saved server that is temporarily unavailable', async () => {
  call.mockImplementation(async (request: { action: string }) => {
    if (request.action === 'connect') throw 'offline';
    return account;
  });
  render(<CloudAccountSettings active />);
  expect((await screen.findByRole('alert')).textContent).toContain('无法连接已保存的服务器');
  expect(screen.queryByLabelText('密码')).toBeNull();
  call.mockResolvedValue(account);
  fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
  await screen.findByRole('button', { name: '登录' });
});
it('retries a previously confirmed HTTP server and displays login fields on success', async () => {
  const saved = { ...account, endpoint: 'http://192.168.1.5:8790/' };
  call.mockImplementation(async (request: { action: string }) => {
    if (request.action === 'connect') throw 'offline';
    return saved;
  });
  render(<CloudAccountSettings active />);
  await screen.findByRole('alert');
  call.mockResolvedValue(saved);
  fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
  await screen.findByLabelText('用户名');
  expect(screen.getByLabelText('密码')).toBeTruthy();
  expect(call).toHaveBeenCalledWith({ action: 'connect', endpoint: saved.endpoint });
});
it('starts with a blank server address', async () => {
  call.mockResolvedValue({ ...account, endpoint: '', server_id: '' });
  render(<CloudAccountSettings active />);
  await waitFor(() => expect(call).toHaveBeenCalled());
  expect(screen.getByLabelText('服务器 IP 或地址')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: '连接服务器' })).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: /暂不登录/ })).toBeNull();
});
it('requires renewed consent for each unencrypted server address', async () => {
  render(<CloudAccountSettings active />);
  await waitFor(() => expect(screen.getByLabelText('服务器 IP 或地址')).toHaveProperty('value', ''));
  const input = screen.getByLabelText('服务器 IP 或地址');
  fireEvent.change(input, { target: { value: 'http://192.168.1.5:8790' } });
  const button = screen.getByRole('button', { name: '连接服务器' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(button).toHaveProperty('disabled', false);
  fireEvent.change(input, { target: { value: 'http://192.168.1.6:8790' } });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox'));
  await connect();
  expect(call).toHaveBeenCalledWith({ action: 'connect', endpoint: 'http://192.168.1.6:8790/' });
});
it('keeps connection failure visible and does not expose credential submission', async () => {
  render(<CloudAccountSettings active />);
  await waitFor(() => expect(screen.getByLabelText('服务器 IP 或地址')).toHaveProperty('value', ''));
  fireEvent.change(screen.getByLabelText('服务器 IP 或地址'), { target: { value: account.endpoint } });
  call.mockRejectedValueOnce('服务器不可达');
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  expect((await screen.findByRole('alert')).textContent).toContain('服务器不可达');
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(call.mock.calls.some(([r]) => r.action === 'login' || r.action === 'register')).toBe(false);
});
it('changing IP invalidates verification and clears the password', async () => {
  render(<CloudAccountSettings active />);
  await waitFor(() => screen.getByLabelText('服务器 IP 或地址'));
  fireEvent.change(screen.getByLabelText('服务器 IP 或地址'), { target: { value: account.endpoint } });
  await connect();
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '更改' }));
  expect(screen.getByRole('dialog', { name: '服务器设置' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: '10.0.0.2' } });
  fireEvent.click(screen.getByRole('button', { name: '连接并保存' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'connect', endpoint: 'https://10.0.0.2:18793/' }));
  await waitFor(() => expect(screen.getByLabelText('密码')).toHaveProperty('value', ''));
});
it('keeps login failure visible after verification', async () => {
  render(<CloudAccountSettings active />); await waitFor(() => screen.getByLabelText('服务器 IP 或地址')); fireEvent.change(screen.getByLabelText('服务器 IP 或地址'), { target: { value: account.endpoint } }); await connect();
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  call.mockRejectedValueOnce('密码错误');
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  expect((await screen.findByRole('alert')).textContent).toContain('密码错误');
});
it('disables registration and explains how to obtain an account', async () => {
  render(<CloudAccountSettings active />); await waitFor(() => screen.getByLabelText('服务器 IP 或地址'));
  fireEvent.change(screen.getByLabelText('服务器 IP 或地址'), { target: { value: account.endpoint } }); await connect();
  expect(screen.getByRole('button', { name: '注册新账户' })).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('注册新账户不可用，请联系管理员')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '注册新账户' }));
  expect(call.mock.calls.some(([r]) => r.action === 'register')).toBe(false);
});
it('normalizes bare IP and explicit ports without changing explicit URL ports', () => {
  expect(cloudServerAddress(' 10.0.0.1 ')).toBe('https://10.0.0.1:18793/');
  expect(cloudServerAddress('10.0.0.1:18888')).toBe('https://10.0.0.1:18888/');
  expect(cloudServerAddress('10.0.0.1:443')).toBe('https://10.0.0.1/');
  expect(cloudServerAddress('https://10.0.0.1')).toBe('https://10.0.0.1/');
  expect(() => cloudServerAddress('https://user:pass@10.0.0.1')).toThrow();
  expect(() => cloudServerAddress('https://10.0.0.1/path')).toThrow();
});
