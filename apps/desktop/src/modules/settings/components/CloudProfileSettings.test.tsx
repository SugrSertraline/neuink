// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudProfileSettings } from './CloudProfileSettings';
const call=vi.hoisted(()=>vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi',()=>({cloudAccount:call}));
afterEach(()=>{cleanup();call.mockReset();});
const profile={username:'alice',nickname:'',full_name:'',email:'',bio:'',affiliation:'',profile_revision:3,admin:false};
const storage={quota:2147483648,used_bytes:2147483648,reserved_bytes:0,available_bytes:0,file_bytes:2147483648,metadata_bytes:0};
it('keeps profile optional and warns when quota is exhausted',async()=>{
  call.mockResolvedValueOnce(profile).mockResolvedValueOnce(storage);
  render(<CloudProfileSettings account={{endpoint:'https://example.test',server_id:'s',account_id:'a',username:'alice'}}/>);
  await screen.findByRole('button',{name:'编辑'});
  expect(screen.getAllByText('未填写')).toHaveLength(4);
  expect(screen.getByRole('heading', { name: '默认昵称' })).toBeTruthy();
  expect(screen.getByText('账号：alice')).toBeTruthy();
  expect(screen.queryByLabelText('昵称')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'编辑'}));
  expect(await screen.findByLabelText('昵称')).toHaveProperty('value','');
  expect(screen.getByText(/可用空间已用完/)).toBeTruthy();
  expect(screen.getByText(/邮箱尚未验证/)).toBeTruthy();
});
it('sends the revision and retains unsaved edits on conflict',async()=>{
  call.mockResolvedValueOnce(profile).mockResolvedValueOnce(storage);
  render(<CloudProfileSettings account={{endpoint:'https://example.test',server_id:'s',account_id:'a',username:'alice'}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'编辑'}));
  fireEvent.change(await screen.findByLabelText('昵称'),{target:{value:'新昵称'}});
  call.mockRejectedValueOnce('资料已在其他设备修改');
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('其他设备'));
  expect(screen.getByLabelText('昵称')).toHaveProperty('value','新昵称');
  expect(call).toHaveBeenLastCalledWith({action:'save_profile',profile:{...profile,nickname:'新昵称'}});
});

it('keeps dirty dialog open on Escape and explicitly discards edits',async()=>{
 call.mockResolvedValueOnce(profile).mockResolvedValueOnce(storage);
 render(<CloudProfileSettings account={{endpoint:'https://example.test',server_id:'s',account_id:'a',username:'alice'}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'编辑'}));fireEvent.change(screen.getByLabelText('昵称'),{target:{value:'Unsaved'}});
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
 expect(screen.getByLabelText('昵称')).toHaveProperty('value','Unsaved');
 fireEvent.click(screen.getByRole('button',{name:'放弃修改'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(screen.getAllByText('未填写')).toHaveLength(4);
});
