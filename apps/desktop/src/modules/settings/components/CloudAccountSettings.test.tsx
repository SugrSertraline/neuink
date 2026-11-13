// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudAccountSettings } from './CloudAccountSettings';
import { cloudServerAddress } from './cloudServerAddress';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: call }));
vi.mock('./SettingsPrimitives', () => ({ SettingsGroup: ({ children }: { children: React.ReactNode }) => <section>{children}</section> }));
const account = { endpoint: 'https://10.0.0.1:18793/', server_id: 'saved-server', account_id: null, username: null };
afterEach(cleanup);
beforeEach(() => { call.mockReset(); call.mockResolvedValue(account); });
async function connect() {
  await waitFor(() => expect(screen.getByRole('button', { name: '连接服务器' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  await screen.findByRole('button', { name: '登录' });
}
it('does not contact account storage while inactive', () => {
  render(<CloudAccountSettings active={false} />);
  expect(call).not.toHaveBeenCalled();
});
it('requires an explicit successful connection even for a saved server', async () => {
  render(<CloudAccountSettings active />);
  await waitFor(() => expect(screen.getByLabelText('服务器 IP 或地址')).toHaveProperty('value', account.endpoint));
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(screen.queryByRole('button', { name: '登录' })).toBeNull();
  expect(call.mock.calls.every(([r]) => r.action === 'status')).toBe(true);
  await connect();
  expect(call).toHaveBeenCalledWith({ action: 'connect', endpoint: account.endpoint });
  expect(screen.getByLabelText('用户名')).toHaveProperty('value', '');
  expect(screen.getByLabelText('密码')).toHaveProperty('value', '');
});
it('starts with a blank server address and gives the campus network requirement', async () => {
  call.mockResolvedValue({ ...account, endpoint: '', server_id: '' });
  render(<CloudAccountSettings active />);
  await waitFor(() => expect(call).toHaveBeenCalled());
  expect(screen.getByLabelText('服务器 IP 或地址')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: '连接服务器' })).toHaveProperty('disabled', true);
  expect(screen.getByText(/云端同步请在东北大学校园网环境下/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /暂不登录/ })).toBeNull();
});
it('keeps connection failure visible and does not expose credential submission', async () => {
  render(<CloudAccountSettings active />);
  await waitFor(() => expect(screen.getByLabelText('服务器 IP 或地址')).toHaveProperty('value', account.endpoint));
  call.mockRejectedValueOnce('服务器不可达');
  fireEvent.click(screen.getByRole('button', { name: '连接服务器' }));
  expect((await screen.findByRole('alert')).textContent).toContain('服务器不可达');
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(call.mock.calls.some(([r]) => r.action === 'login' || r.action === 'register')).toBe(false);
});
it('changing IP invalidates verification and clears the password', async () => {
  render(<CloudAccountSettings active />);
  await connect();
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  fireEvent.change(screen.getByLabelText('服务器 IP 或地址'), { target: { value: '10.0.0.2' } });
  expect(screen.queryByLabelText('密码')).toBeNull();
  await connect();
  expect(call).toHaveBeenCalledWith({ action: 'connect', endpoint: 'https://10.0.0.2:18793/' });
  expect(screen.getByLabelText('密码')).toHaveProperty('value', '');
});
it('keeps login failure visible after verification', async () => {
  render(<CloudAccountSettings active />); await connect();
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'alice' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  call.mockRejectedValueOnce('密码错误');
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  expect((await screen.findByRole('alert')).textContent).toContain('密码错误');
});
it('allows registration only after connecting and keeps invitation optional', async () => {
  render(<CloudAccountSettings active />); await connect();
  fireEvent.click(screen.getByRole('button', { name: '注册新账户' }));
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'new-reader' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '注册账户' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: 'register', username: 'new-reader', password: 'long-test-password', invite: '' }));
  await screen.findByText('注册成功，请登录。');
});
it('normalizes bare IP and explicit ports without changing explicit URL ports', () => {
  expect(cloudServerAddress(' 10.0.0.1 ')).toBe('https://10.0.0.1:18793/');
  expect(cloudServerAddress('10.0.0.1:18888')).toBe('https://10.0.0.1:18888/');
  expect(cloudServerAddress('10.0.0.1:443')).toBe('https://10.0.0.1/');
  expect(cloudServerAddress('https://10.0.0.1')).toBe('https://10.0.0.1/');
  expect(() => cloudServerAddress('https://user:pass@10.0.0.1')).toThrow();
  expect(() => cloudServerAddress('https://10.0.0.1/path')).toThrow();
});
