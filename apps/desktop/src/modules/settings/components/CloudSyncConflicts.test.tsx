// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudSyncConflicts } from './CloudSyncConflicts';
const call=vi.hoisted(()=>vi.fn());
vi.mock('@/shared/ipc/cloudAccountApi',()=>({cloudAccount:call}));
afterEach(()=>{cleanup();call.mockReset();});
const comparison={base:{title:'Base'},local:{title:'Local'},remote:{object_id:'note:n',content:{title:'Remote'},revision:4},token:'comparison-token',notes:[{title:'Note',markdown:'Base'},{title:'Note',markdown:'Local'},{title:'Note',markdown:'Remote'}]};
it('requires confirmation and keeps stale comparisons visible on rejection',async()=>{
 call.mockImplementation(async request=>{if(request.action==='sync_conflicts')return ['note:n'];if(request.action==='sync_resolve')throw '冲突内容已更新，请重新核对双方修改';return comparison;});
 const onResolved=vi.fn();render(<CloudSyncConflicts root="library" disabled={false} onResolved={onResolved}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看及处理冲突'}));fireEvent.click(await screen.findByRole('button',{name:'note:n'}));
 fireEvent.click(await screen.findByRole('button',{name:'采用云端'}));
 expect(call.mock.calls.some(([r])=>r.action==='sync_resolve')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'确认处理'}));
 await screen.findByText('冲突内容已更新，请重新核对双方修改');
 expect(call).toHaveBeenCalledWith({action:'sync_resolve',root:'library',id:'note:n',token:'comparison-token',keep_local:false});expect(onResolved).not.toHaveBeenCalled();
});
it('submits only explicitly confirmed merged text and protects unsaved merge on Escape',async()=>{
 let resolved=false;call.mockImplementation(async request=>{if(request.action==='sync_conflicts')return resolved?[]:['note:n'];if(request.action==='sync_merge_note'){resolved=true;return {ok:true};}return comparison;});
 const onResolved=vi.fn();render(<CloudSyncConflicts root="library" disabled={false} onResolved={onResolved}/>);
 fireEvent.click(screen.getByRole('button',{name:'查看及处理冲突'}));fireEvent.click(await screen.findByRole('button',{name:'note:n'}));
 fireEvent.click(await screen.findByRole('button',{name:'手工合并笔记正文'}));
 fireEvent.change(screen.getByRole('textbox',{name:'合并后的笔记正文'}),{target:{value:'Merged text'}});
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.getByRole('textbox',{name:'合并后的笔记正文'})).toHaveProperty('value','Merged text');
 fireEvent.click(screen.getByRole('button',{name:'保存合并正文'}));expect(call.mock.calls.some(([r])=>r.action==='sync_merge_note')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'确认保存合并正文'}));
 await waitFor(()=>expect(onResolved).toHaveBeenCalledOnce());
 expect(call).toHaveBeenCalledWith({action:'sync_merge_note',root:'library',id:'note:n',token:'comparison-token',markdown:'Merged text'});
});
