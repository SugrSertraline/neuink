// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudPasswordSettings } from './CloudPasswordSettings';
const call=vi.hoisted(()=>vi.fn());vi.mock('@/shared/ipc/cloudAccountApi',()=>({cloudAccount:call}));
afterEach(()=>{cleanup();call.mockReset();});
it('validates confirmation and revokes the local session after password update',async()=>{
 call.mockResolvedValue({ok:true});const changed=vi.fn().mockResolvedValue(undefined);
 render(<CloudPasswordSettings loggedIn endpoint="https://example.test" onChanged={changed}/>);
 expect(screen.queryByLabelText('当前密码')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'修改密码'}));
 expect(screen.getByRole('dialog')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('当前密码'),{target:{value:'old-test-password'}});
 fireEvent.change(screen.getByLabelText('新密码'),{target:{value:'new-test-password'}});
 const button=screen.getByRole('button',{name:'确认更新密码并撤销旧会话'});expect(button).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByLabelText('再次输入新密码'),{target:{value:'new-test-password'}});fireEvent.click(button);
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
 expect(call.mock.calls.map(([r])=>r.action)).toEqual(['password','logout']);expect(screen.getByLabelText('新密码')).toHaveProperty('value','');
});

it('clears secret inputs when the dialog closes',async()=>{
 render(<CloudPasswordSettings loggedIn endpoint="https://example.test" onChanged={async()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'修改密码'}));
 fireEvent.change(screen.getByLabelText('当前密码'),{target:{value:'secret'}});
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'修改密码'}));
 expect(screen.getByLabelText('当前密码')).toHaveProperty('value','');
});

it('does not expose the old administrator proof control when signed out', () => {
 render(<CloudPasswordSettings loggedIn={false} endpoint="https://example.test" onChanged={async()=>{}} />);
 expect(screen.queryByRole('button')).toBeNull();
});
