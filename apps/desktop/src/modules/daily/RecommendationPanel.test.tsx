// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DailyProvider } from './DailyContext';
import { RecommendationPanel } from './RecommendationPanel';
import { DailyDashboardView } from './DailyDashboard';
import { formatLocalDate } from '@/modules/reader/components/libraryReading';
const ipc=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock('@tauri-apps/api/core',()=>({invoke:ipc.invoke}));
let generated:number;const today=formatLocalDate(new Date());
const daily={version:1,widgets:[],lists:[],todos:[],recommendation_preferences:{interests:['diffusion'],exclusions:[],enabled:false}};
let state:any;
beforeEach(()=>{
 generated=0;state={version:1,batches:[],feedback:[],last_error:null,last_attempt_at:null};
 ipc.invoke.mockReset().mockImplementation(async(command,args)=>{
  if(command==='daily_workspace')return {revision:'1',state:daily};
  if(command==='daily_recommendations'){
   if(args.request.action.kind==='generate'){generated++;state.batches=[{date:args.request.action.date,interest_key:'arxiv.py:test',interests:['diffusion'],papers:[]}];}
   if(args.request.action.kind==='feedback'){
    const {id,ignored,saved}=args.request.action;
    state.feedback=[...state.feedback.filter((item:{id:string})=>item.id!==id),{id,ignored,saved}];
   }
   return structuredClone(state);
  }
 });
});
afterEach(cleanup);
const setup=()=>render(<DailyProvider root="isolated" openNote={vi.fn()}><RecommendationPanel active/></DailyProvider>);
it('fetches on application startup without opening the board, and does not loop on empty results',async()=>{
 const ui=render(<DailyProvider root="isolated" openNote={vi.fn()}><RecommendationPanel/></DailyProvider>);await waitFor(()=>expect(generated).toBe(1));
 await waitFor(()=>expect(ui.getByText(/本次没有找到匹配/)).toBeTruthy());
 ui.rerender(<DailyProvider root="isolated" openNote={vi.fn()}><RecommendationPanel active/></DailyProvider>);await act(async()=>{await Promise.resolve();});
 expect(generated).toBe(1);
});

it('serves a successful empty day locally after remount without a generate call',async()=>{
 state.batches=[{date:today,interest_key:'arxiv.py:previous-interests',interests:['robotics'],papers:[]}];
 const ui=setup();await waitFor(()=>expect(ui.getByText(/已保存到本地/)).toBeTruthy());
 expect(generated).toBe(0);ui.unmount();
 const reopened=setup();await waitFor(()=>expect(reopened.getByText(/本次没有找到匹配/)).toBeTruthy());
 expect(generated).toBe(0);
});

it('fetches a new local day while the app remains open',async()=>{
 const ui=setup();await waitFor(()=>expect(generated).toBe(1));
 const next = new Date(); next.setDate(next.getDate()+1);
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(next);
 try {
  await act(async()=>{window.dispatchEvent(new Event('focus'));});
  await waitFor(()=>expect(generated).toBe(2));
  expect(state.batches[0].date).toBe(formatLocalDate(next));
  expect(ui.getByText(/已保存到本地/)).toBeTruthy();
 } finally {vi.useRealTimers();}
});

it('does not repeatedly retry a failure on rerender but retries on the next application launch',async()=>{
 const original=ipc.invoke.getMockImplementation()!;let attempts=0;
 ipc.invoke.mockImplementation(async(command,args)=>{
  if(command==='daily_recommendations' && args.request.action.kind==='generate'){attempts++;throw new Error('offline');}
  return original(command,args);
 });
 const ui=setup();await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('offline'));
 ui.rerender(<DailyProvider root="isolated" openNote={vi.fn()}><RecommendationPanel active/></DailyProvider>);await act(async()=>{await Promise.resolve();});expect(attempts).toBe(1);
 ui.unmount();setup();await waitFor(()=>expect(attempts).toBe(2));
});
it('requires no interest configuration or assistant tool setting changes',async()=>{
 const ui=setup();await waitFor(()=>expect(generated).toBe(1));
 expect(ui.queryByText('兴趣设置')).toBeNull();expect(ui.queryByLabelText('固定研究兴趣')).toBeNull();
 expect(ui.queryByLabelText('排除方向')).toBeNull();expect(ui.queryByText(/减少「/)).toBeNull();
 expect(ui.getByText(/根据最近 14 天阅读论文的标签自动推荐/)).toBeTruthy();
 expect(ipc.invoke.mock.calls.some(([command])=>['get_research_settings','save_research_settings'].includes(command))).toBe(false);
 expect(ipc.invoke.mock.calls.some(([command,args])=>command==='daily_workspace' && args.request.action.kind==='save')).toBe(false);
});
it('keeps recommendations available when reading statistics fail and removes notes/todos and entertainment',async()=>{
 const ui=render(<DailyProvider root="isolated" openNote={vi.fn()}><DailyDashboardView entries={[]} states={{}} loading={false} error="阅读统计失败" onRetry={vi.fn()} onOpenEntry={vi.fn()} onOpenLibrary={vi.fn()}/></DailyProvider>);
 await waitFor(()=>expect(generated).toBe(1));
 expect(ui.getByRole('region',{name:'每日论文推荐'})).toBeTruthy();
 expect(ui.queryByRole('region',{name:'每日记录'})).toBeNull();
 expect(ui.queryByText('记录与待办')).toBeNull();expect(ui.queryByText('待办清单')).toBeNull();
 expect(ui.queryByRole('region',{name:'娱乐时长'})).toBeNull();
 expect(ipc.invoke.mock.calls.some(([command])=>command==='entertainment_activity')).toBe(false);
 expect(ui.queryByLabelText('阅读汇总')).toBeNull();
});

it('revalidates a legacy empty batch once on opening instead of treating it as final',async()=>{
 state.batches=[{date:today,interest_key:'legacy',interests:['交通流量预测'],papers:[]}];
 const ui=setup();await waitFor(()=>expect(generated).toBe(1));
 ui.rerender(<DailyProvider root="isolated" openNote={vi.fn()}><RecommendationPanel active/></DailyProvider>);await act(async()=>{await Promise.resolve();});
 expect(generated).toBe(1);
});

it('prevents duplicate refresh while fetching and supports explicit refresh afterwards',async()=>{
 const original=ipc.invoke.getMockImplementation()!;let release!:()=>void,first=true;
 ipc.invoke.mockImplementation(async(command,args)=>{
  if(command==='daily_recommendations' && args.request.action.kind==='generate' && first){
   first=false;await new Promise<void>(resolve=>{release=resolve;});
  }
  return original(command,args);
 });
 const ui=setup();await waitFor(()=>expect(release).toBeTypeOf('function'));
 expect(ui.getByRole('button',{name:'获取中…'}).hasAttribute('disabled')).toBe(true);
 await act(async()=>{release();});await waitFor(()=>expect(generated).toBe(1));
 await waitFor(()=>expect(ui.getByRole('button',{name:'刷新推荐'}).hasAttribute('disabled')).toBe(false));
 fireEvent.click(ui.getByRole('button',{name:'刷新推荐'}));await waitFor(()=>expect(generated).toBe(2));
});

it('restores ignored cached papers without a fetch and preserves legacy saved flags',async()=>{
 state.batches=[{date:today,interests:['diffusion'],papers:[{id:'arxiv:sample',title:'Matching diffusion paper',url:'https://arxiv.org/abs/sample',authors:[],published:'2026-10-24',categories:[],reasons:[],matched_interests:[],abstract_text:'A sample abstract'}]}];
 state.feedback=[{id:'arxiv:sample',ignored:true,saved:true}];
 const ui=render(<DailyProvider root="isolated" openNote={vi.fn()}><RecommendationPanel/></DailyProvider>);
 await waitFor(()=>expect(ui.getByText('当前推荐均已忽略。')).toBeTruthy());
 expect(ui.queryByText('Matching diffusion paper')).toBeNull();
 fireEvent.click(ui.getByText('显示全部推荐'));
 expect(ui.getByText('Matching diffusion paper')).toBeTruthy();expect(generated).toBe(0);
 fireEvent.click(ui.getByRole('button',{name:'恢复推荐'}));
 await waitFor(()=>expect(ui.getByRole('button',{name:'忽略'})).toBeTruthy());
 expect(state.feedback).toEqual([{id:'arxiv:sample',ignored:false,saved:true}]);
 fireEvent.click(ui.getByLabelText('显示已忽略'));
 expect(ui.getByText('Matching diffusion paper')).toBeTruthy();
 fireEvent.click(ui.getByRole('button',{name:'忽略'}));
 await waitFor(()=>expect(ui.queryByText('Matching diffusion paper')).toBeNull());
 expect(state.feedback).toEqual([{id:'arxiv:sample',ignored:true,saved:true}]);expect(generated).toBe(0);
});

it('shows a retrieval failure without misreporting it as an empty recommendation result and allows retry',async()=>{
 state.batches=[{date:today,interest_key:'legacy',interests:['交通流量预测'],papers:[]}];
 const original=ipc.invoke.getMockImplementation()!;let fail=true;
 ipc.invoke.mockImplementation(async(command,args)=>{
  if(command==='daily_recommendations' && args.request.action.kind==='generate' && fail)throw new Error('arXiv 请求过于频繁（HTTP 429），请等待 1 分钟后重试');
  return original(command,args);
 });
 const ui=setup();await waitFor(()=>expect(ui.getByRole('alert').textContent).toContain('HTTP 429'));
 expect(ui.queryByText(/本次没有找到匹配/)).toBeNull();
 fail=false;fireEvent.click(ui.getByText('重试获取'));
 await waitFor(()=>expect(ui.queryByRole('alert')).toBeNull());expect(generated).toBe(1);
});


it('shows missing reading tags as guidance without a configuration form or repeated requests',async()=>{
 const original=ipc.invoke.getMockImplementation()!;
 ipc.invoke.mockImplementation(async(command,args)=>{
  if(command==='daily_recommendations' && args.request.action.kind==='generate'){generated++;throw '暂无近期阅读标签可用于推荐。阅读带研究标签的论文后再试。';}
  return original(command,args);
 });
 const ui=setup();await waitFor(()=>expect(ui.getByRole('status').textContent).toContain('暂无近期阅读标签'));
 expect(ui.queryByRole('alert')).toBeNull();expect(ui.queryByRole('textbox')).toBeNull();expect(generated).toBe(1);
});
