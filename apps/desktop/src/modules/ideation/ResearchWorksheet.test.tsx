// @vitest-environment jsdom
import { IdeationSidebar } from './IdeationSidebar';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IdeationWorkspace } from './IdeationWorkspace';
import { IdeationProvider } from './IdeationContext';
import { TooltipProvider } from '@/components/ui/tooltip';
const api = vi.hoisted(() => ({ read:vi.fn(),save:vi.fn(),load:vi.fn(),recommend:vi.fn() }));
vi.mock('@/shared/ipc/ideationApi', () => ({ readIdeation:api.read,saveIdeation:api.save }));
vi.mock('./useIdeationBackground', () => ({useIdeationBackground: () => ({summaries:[]})}));
vi.mock('./methodRecommendations', async original => ({ ...await original<typeof import('./methodRecommendations')>(),loadMethodCandidates:api.load,recommendMethods:api.recommend }));
vi.mock('@/shared/components/SourceSnapshotPreview', () => ({SourceSnapshotPreview: ({markdown}:{markdown:string}) => <pre>{markdown}</pre>}));
const method = {id:'method',entry_id:'paper',kind:'method',title:'恢复方法',body:'从观测恢复',origin:'ai_reviewed'};
const other = {...method,id:'other',title:'图重建'};
const initial = {version:2,boards:[{id:'b',title:'构思',description:'降低开销',created_at:'',updated_at:''}],cards:[method],placements:[{id:'p',card_id:'method',board_id:'b',x:0,y:0}],links:[]};
beforeEach(() => {localStorage.clear();vi.clearAllMocks();api.read.mockResolvedValue({revision:'r',state:structuredClone(initial)});api.save.mockImplementation(async (_r,_v,state)=>({revision:'next',state}));api.load.mockResolvedValue({cards:[method,other],failures:0});api.recommend.mockResolvedValue({recommendations:[{cardId:'other',relation:'complement',reason:'补足关系',combination:'恢复后重建',caution:'误差待验证'}],gap:'',plan:''});});
afterEach(cleanup);
const describe = (field: string, body: string) => { fireEvent.click(screen.getByRole('button',{name:`自己描述${field}`})); fireEvent.change(screen.getByLabelText('本构思内容标题'),{target:{value:body}}); fireEvent.change(screen.getByLabelText('本构思内容正文'),{target:{value:body}}); fireEvent.click(screen.getByRole('button',{name:'保存到本构思'})); };
const open = () => render(<TooltipProvider><IdeationProvider root="test"><IdeationSidebar root="test" entries={[]} onOpenEntry={vi.fn()} onOpenSource={vi.fn()} /><IdeationWorkspace root="test" entries={[]} onOpenEntry={vi.fn()} /></IdeationProvider></TooltipProvider>);
it('shows a worksheet instead of a canvas and persists typed fields', async () => {
  open(); await screen.findByLabelText('研究方案填写页');
  expect(screen.queryByLabelText('构思画布')).toBeNull();
  describe('研究问题','提高鲁棒性');
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(api.save).toHaveBeenCalled());
  expect(api.save.mock.calls[api.save.mock.calls.length-1]![2].cards.some((c:any)=>c.body==='提高鲁棒性')).toBe(true);
});
it('requires an explicit add and automatically recommends after adding a method', async () => {
  open();await screen.findByLabelText('研究方案填写页');
  fireEvent.click(screen.getByRole('button',{name:'添加方法步骤'}));
  await screen.findByText('补足关系');
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('region',{name:'推荐卡片'})).getByRole('button',{name:'加入方法步骤'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'移除图重建'})).toBeTruthy());
  expect(screen.getByRole('button',{name:'移除图重建'})).toBeTruthy();
});
it('discards stale responses after editing the problem', async () => {
  let finish!: (value:any)=>void;api.recommend.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  open();await screen.findByLabelText('研究方案填写页');
  fireEvent.click(screen.getByRole('button',{name:'添加方法步骤'}));
  await waitFor(()=>expect(api.recommend).toHaveBeenCalled());
  describe('研究问题','不同问题');
  await act(async()=>finish({recommendations:[],gap:'过期结果',plan:''}));
  expect(screen.queryByText(/过期结果/)).toBeNull();
});

it('adds multiple private background cards and allows editing without creating library cards', async () => {
  open();await screen.findByLabelText('研究方案填写页');
  for (const title of ['设备场景','数据条件']) {
    fireEvent.click(screen.getByRole('button',{name:'自己描述研究背景'}));
    fireEvent.change(screen.getByLabelText('本构思内容标题'),{target:{value:title}});
    fireEvent.change(screen.getByLabelText('本构思内容正文'),{target:{value:'仅当前构思使用的说明'}});
    fireEvent.click(screen.getByRole('button',{name:'保存到本构思'}));
  }
  fireEvent.click(screen.getByRole('button',{name:'编辑设备场景'}));
  fireEvent.change(screen.getByLabelText('本构思内容正文'),{target:{value:'修订的场景'}});
  fireEvent.click(screen.getByRole('button',{name:'保存到本构思'}));
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(api.save).toHaveBeenCalled());
  const saved=api.save.mock.calls[api.save.mock.calls.length-1][2];
  expect(saved.cards.filter((c:any)=>c.kind==='background' && c.id.startsWith('local-idea-'))).toHaveLength(2);
  expect(saved.placements.some((n:any)=>n.body==='修订的场景' && n.board_id==='b')).toBe(true);
  expect(screen.getByRole('button',{name:'移除数据条件'})).toBeTruthy();
});

it('offers private and library cards in every section and persists method order without a new model call', async () => {
  api.read.mockResolvedValue({revision:'r',state:{...initial,cards:[method,other],placements:[...initial.placements,{id:'q',card_id:'other',board_id:'b',x:0,y:0}]}});
  open();await screen.findByLabelText('研究方案填写页');
  for (const field of ['研究背景','研究问题','方法步骤']) {
    expect(screen.getByRole('button',{name:`自己描述${field}`})).toBeTruthy();
    expect(screen.getByRole('button',{name:`添加${field}`})).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button',{name:'前移图重建'}));
  expect((screen.getByRole('button',{name:'前移图重建'}) as HTMLButtonElement).disabled).toBe(true);
  expect(api.recommend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  await waitFor(()=>expect(api.save).toHaveBeenCalled());
  expect(api.save.mock.calls[api.save.mock.calls.length-1][2].placements.map((n:any)=>n.card_id)).toEqual(['other','method']);
});

it('opens matching recommendations above an unfiltered library and merges constraints into background', async () => {
  const constraint={...other,id:'constraint',kind:'constraint',title:'内存限制'};
  api.read.mockResolvedValue({revision:'r',state:{...initial,cards:[method,constraint],placements:[...initial.placements,{id:'constraint-node',card_id:'constraint',board_id:'b',x:0,y:0}]}});
  open();await screen.findByLabelText('研究方案填写页');
  expect(screen.queryByRole('region',{name:'要求与条件（选填）'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'添加研究背景'}));
  await waitFor(()=>expect(api.recommend).toHaveBeenCalled());
  expect(api.recommend.mock.calls[0][0].section).toBe('background');
  expect(screen.getByRole('heading',{name:'全部卡片'})).toBeTruthy();
  expect(screen.getByTestId('library-card-method')).toBeTruthy();
  expect(screen.getByRole('heading',{name:'推荐 · 研究背景'})).toBeTruthy();
});

it('restores a removed method at its original position when undoing', async () => {
  api.read.mockResolvedValue({revision:'r',state:{...initial,cards:[method,other],placements:[...initial.placements,{id:'q',card_id:'other',board_id:'b',x:0,y:0}]}});
  open();await screen.findByLabelText('研究方案填写页');
  fireEvent.click(screen.getByRole('button',{name:'移除恢复方法'}));
  fireEvent.click(screen.getByRole('button',{name:'撤销'}));
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  // Returning to the saved state needs no write; order still determines the first-step disabled control.
  expect((screen.getByRole('button',{name:'前移恢复方法'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'后移图重建'}) as HTMLButtonElement).disabled).toBe(true);
});
