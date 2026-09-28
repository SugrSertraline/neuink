// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act as reactAct } from '@testing-library/react';
import { ParadisePage } from './ParadisePage';
import { createWorld, evolve } from './world';
const api=vi.hoisted(()=>({read:vi.fn(),save:vi.fn()}));
vi.mock('@/shared/ipc/paradiseApi',()=>({readParadise:api.read,saveParadise:api.save}));
vi.mock('./useShenyangWeather',()=>({useShenyangWeather:()=>({data:null,loading:false,error:'',stale:false,retry:()=>{}})}));
vi.mock('./DormScene',()=>({DormScene:({input,name,onWave}:{input:{away:boolean};name:string;onWave:()=>void})=>input.away?null:<button aria-label={`和${name}打招呼`} onClick={onWave}/> }));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.restoreAllMocks();});
const mount=()=>render(<ParadisePage root="test" active onBack={()=>{}}/>);
describe('travel persistence and interaction',()=>{
  it('saves weather only after acknowledgement and closes the action panel to play',async()=>{
    api.read.mockResolvedValue({revision:1,world:createWorld()});
    api.save.mockImplementation(async(_root,_rev,world)=>({revision:2,world}));
    mount();fireEvent.click(await screen.findByRole('button',{name:/陪伴 · 发呆/}));
    fireEvent.click(screen.getByRole('button',{name:'冬日'}));
    await waitFor(()=>expect(api.save).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByRole('button',{name:'冬日'}).getAttribute('aria-pressed')).toBe('true'));
    expect(api.save.mock.calls[0][2].atmosphere).toEqual({season:'winter',weather:'auto'});
    fireEvent.click(screen.getByRole('button',{name:'用笔记本'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button',{name:'陪伴 · 用笔记本'})).toBeTruthy();
  });
  it('does not depart until a destination is confirmed and keeps missing art explicit',async()=>{
    api.read.mockResolvedValue({revision:1,world:createWorld()});
    mount();fireEvent.click(await screen.findByRole('button',{name:/去逛逛/}));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio',{name:/小南湖/}));
    expect(screen.getByRole('button',{name:/出发去小南湖/})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'关闭游戏面板'}));
    expect(api.save).not.toHaveBeenCalled();
  });
  it('shows campus text postcards without passing trial art off as a real building',async()=>{
    const w=evolve(createWorld(),{type:'depart',destination:'teaching',now:Date.now()-120000,id:'one'});
    api.read.mockResolvedValue({revision:1,world:w});mount();
    fireEvent.click(await screen.findByRole('button',{name:/来信/}));
    expect(screen.getByText('文字明信片')).toBeTruthy();
    expect(screen.queryByAltText('海豹在林荫路招手的游戏旅行照片')).toBeNull();
  });
  it('does not apply an old workspace save acknowledgement to the new workspace',async()=>{
    api.read.mockResolvedValue({revision:1,world:createWorld()});
    let finish!:(v:unknown)=>void;api.save.mockImplementation(()=>new Promise(r=>finish=r));
    const view=mount();fireEvent.click(await screen.findByRole('button',{name:/去逛逛/}));
    fireEvent.click(screen.getByRole('button',{name:/出发去信息学馆/}));
    const saved=api.save.mock.calls[0][2];
    api.read.mockResolvedValue({revision:4,world:{...createWorld(),name:'新伙伴'}});
    view.rerender(<ParadisePage root="new" active onBack={()=>{}}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'和新伙伴打招呼',hidden:true})).toBeTruthy());
    await reactAct(async()=>finish({revision:2,world:saved}));
    expect(screen.getByRole('button',{name:'和新伙伴打招呼',hidden:true})).toBeTruthy();
  });
  it('does not silently reset an unreadable save',async()=>{
    api.read.mockRejectedValue(new Error('broken'));mount();
    expect(await screen.findByRole('alert')).toBeTruthy();expect(api.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button',{name:/去逛逛/})).toBeNull();
  });
  it('does not optimistically depart after a failed write',async()=>{
    api.read.mockResolvedValue({revision:2,world:createWorld()});api.save.mockRejectedValue(new Error('冲突'));
    mount();fireEvent.click(await screen.findByRole('button',{name:/去逛逛/}));
    fireEvent.click(screen.getByRole('button',{name:/出发去信息学馆/}));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'关闭游戏面板'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button',{name:/去逛逛/}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button',{name:'和小海豹打招呼'})).toBeTruthy();
  });
  it('does not double-submit and removes the character only after acknowledgement',async()=>{
    api.read.mockResolvedValue({revision:2,world:createWorld()});
    let finish!:(v:unknown)=>void;api.save.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    mount();const button=await screen.findByRole('button',{name:/去逛逛/});
    fireEvent.click(button);
    const depart=screen.getByRole('button',{name:/出发去信息学馆/});
    fireEvent.click(depart);fireEvent.click(depart);expect(api.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:'和小海豹打招呼',hidden:true})).toBeTruthy();
    await reactAct(async()=>finish({revision:3,world:api.save.mock.calls[0][2]}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button',{name:/正在散步/}).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button',{name:'和小海豹打招呼'})).toBeNull();
  });
  it('opens scoped letter modal and collects a real delivered letter once',async()=>{
    const w=evolve(createWorld(),{type:'depart',now:Date.now()-120000,id:'one'});
    api.read.mockResolvedValue({revision:1,world:w});
    api.save.mockImplementation(async(_r,_v,world)=>({revision:2,world}));
    mount();fireEvent.click(await screen.findByRole('button',{name:/来信/}));
    const modal=screen.getByRole('dialog');expect(modal.closest('.seal-travel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'收进相册'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'已收进相册'}).hasAttribute('disabled')).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'关闭游戏面板'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('cleans up visible-only timer when hidden and unmounted',async()=>{
    api.read.mockResolvedValue(null);
    const clear=vi.spyOn(globalThis,'clearInterval'),view=mount();await screen.findByRole('button',{name:/去逛逛/});
    view.rerender(<ParadisePage root="test" active={false} onBack={()=>{}}/>);
    expect(clear).toHaveBeenCalled();view.unmount();
  });
  it('ignores stale root reads and late writes',async()=>{
    let resolveOld!:(v:unknown)=>void;
    api.read.mockImplementation((root)=>root==='old'?new Promise(r=>resolveOld=r):Promise.resolve({revision:4,world:{...createWorld(),name:'新伙伴'}}));
    const view=render(<ParadisePage root="old" active onBack={()=>{}}/>);
    view.rerender(<ParadisePage root="new" active onBack={()=>{}}/>);
    await screen.findByRole('button',{name:'和新伙伴打招呼'});
    await reactAct(async()=>resolveOld({revision:1,world:createWorld()}));
    expect(screen.queryByRole('button',{name:'和小海豹打招呼'})).toBeNull();
  });
});
