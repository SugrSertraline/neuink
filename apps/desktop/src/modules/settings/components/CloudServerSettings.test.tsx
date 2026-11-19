// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
import { CloudServerSettings } from './CloudServerSettings';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';

vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: vi.fn(async () => ({})) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('requires renewed confirmation before connecting an HTTP address', async () => {
  render(<CloudServerSettings endpoint="https://example.com" loggedIn={false} disabled={false} onChanged={async () => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '服务器设置' }));
  const input = screen.getByLabelText('服务器地址');
  fireEvent.change(input, { target: { value: 'http://192.168.1.5:8790' } });
  const save = screen.getByRole('button', { name: '连接并保存' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(save.disabled).toBe(false);
  fireEvent.change(input, { target: { value: 'http://192.168.1.6:8790' } });
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(save);
  await waitFor(() => expect(cloudAccount).toHaveBeenCalledWith({ action: 'connect', endpoint: 'http://192.168.1.6:8790/' }));
});
