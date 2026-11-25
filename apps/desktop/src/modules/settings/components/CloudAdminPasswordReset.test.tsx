// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudAdminPasswordReset } from './CloudAdminPasswordReset';
import { ADMIN_PASSWORD_RESET_TARGET } from '../settingsCatalog';
const call = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: call }));
afterEach(() => { cleanup(); call.mockReset(); });
const account = { endpoint:'https://example.test', server_id:'server', account_id:'user', username:'test-admin' };
const target = { id:ADMIN_PASSWORD_RESET_TARGET, nonce:1 };
it('does not execute on opening and requires explicit confirmation by an administrator', async () => {
 call.mockImplementation(async request => request.action === 'profile' ? {admin:true} : {ok:true});
 const changed = vi.fn().mockResolvedValue(undefined);
 render(<CloudAdminPasswordReset account={account} navigationTarget={target} onChanged={changed} />);
 await screen.findByLabelText('新管理员密码');
 expect(call.mock.calls.map(([r])=>r.action)).toEqual(['profile']);
 const submit=screen.getByRole('button',{name:'确认重置并退出全部设备'});
 expect(submit).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByLabelText('新管理员密码'),{target:{value:'new-test-password'}});
 fireEvent.change(screen.getByLabelText('再次输入管理员密码'),{target:{value:'new-test-password'}});
 fireEvent.click(submit);
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
 expect(call.mock.calls.map(([r])=>r.action)).toEqual(['profile','admin_reset_password','logout']);
});
it('blocks ordinary accounts and never asks for administrator reset tokens', async () => {
 call.mockResolvedValue({admin:false});
 render(<CloudAdminPasswordReset account={account} navigationTarget={target} onChanged={async()=>{}} />);
 await screen.findByRole('alert');
 expect(screen.queryByLabelText('新管理员密码')).toBeNull();
 expect(screen.queryByText('一次性重置凭据')).toBeNull();
 expect(call).toHaveBeenCalledTimes(1);
});
it('clears passwords on closing and reopening the command', async () => {
 call.mockResolvedValue({admin:true});
 const view=render(<CloudAdminPasswordReset account={account} navigationTarget={target} onChanged={async()=>{}} />);
 fireEvent.change(await screen.findByLabelText('新管理员密码'),{target:{value:'do-not-retain'}});
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 view.rerender(<CloudAdminPasswordReset account={account} navigationTarget={{...target,nonce:2}} onChanged={async()=>{}} />);
 expect(await screen.findByLabelText('新管理员密码')).toHaveProperty('value','');
});
