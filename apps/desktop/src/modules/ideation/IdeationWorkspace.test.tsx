// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { LegacyIdeationWorkspace as IdeationWorkspace } from './LegacyIdeationWorkspace';
import { IdeationProvider } from './IdeationContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IdeationSidebar } from './IdeationSidebar';
import { ideationCardDrag } from './ideationDrag';

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), draft: vi.fn(), source: vi.fn(), search: vi.fn(), summaries: [] as any[] }));
vi.mock('@/shared/ipc/ideationApi', () => ({ readIdeation: api.read, saveIdeation: api.save, readIdeationDraft: api.draft }));
vi.mock('@/shared/ipc/assistantApi', () => ({ readSegmentContent: api.source }));
vi.mock('@/shared/ipc/workspaceApi', async importOriginal => ({ ...(await importOriginal<typeof import('@/shared/ipc/workspaceApi')>()), searchEntries: api.search }));
vi.mock('./useIdeationBackground', () => ({ useIdeationBackground: () => ({ summaries: api.summaries, enabled: true, setEnabled: vi.fn(), modelKnown: true, modelReady: true, pendingCount: 0, activeId: null, error: null, refresh: vi.fn(), retry: vi.fn() }) }));
const entry = { id: 'paper-1', title: '示例论文', tags: ['因果'], tagIds: [], fields: {}, contents: [] } as unknown as LibraryEntry;
const method = { id: 'c1', entry_id: 'paper-1', title: '反事实方法', body: '改变条件进行对照', kind: 'method' };
const problem = { id: 'c2', entry_id: 'paper-1', title: '研究问题', body: '缺少对照', kind: 'problem' };
afterEach(() => { cleanup(); ideationCardDrag.cancel(); vi.clearAllMocks(); vi.unstubAllGlobals(); api.summaries = []; });
function renderWorkspace(showSidebar = vi.fn(), openSource = vi.fn(), openCardsPage = vi.fn()) {
  return render(<TooltipProvider><IdeationProvider root="workspace" onShowSidebar={showSidebar}><IdeationSidebar root="workspace" entries={[entry]} onOpenEntry={vi.fn()} onOpenCards={openCardsPage} onOpenSource={openSource} />
    <IdeationWorkspace root="workspace" entries={[entry]} onOpenEntry={vi.fn()} onOpenSource={openSource} /></IdeationProvider></TooltipProvider>);
}

beforeEach(() => {
  localStorage.clear();
  api.save.mockImplementation(async (_root, _revision, state) => ({ revision: 'saved', state }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
const empty = { version: 2, cards: [], placements: [], boards: [] };
const board = (id: string, title = id) => ({ id, title, description: '', created_at: '', updated_at: '' });
const twoBoards = () => ({ version: 2, boards: [board('a', '构思甲'), board('b', '构思乙')], cards: [problem, method], placements: [
  { id: 'p1', card_id: 'c2', board_id: 'a', x: 80, y: 80 }, { id: 'p2', card_id: 'c1', board_id: 'a', x: 500, y: 80 },
  { id: 'p3', card_id: 'c2', board_id: 'b', x: 80, y: 80 }
] });
const openPanel = (name: string) => { const button = screen.queryByRole('button', { name: `切换到${name}` }); if (button) fireEvent.click(button); };
const openCards = () => openPanel('卡片库');
const canvas = () => screen.getByLabelText('构思画布');
const savedState = () => api.save.mock.calls[api.save.mock.calls.length - 1]?.[2];
async function save() { fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(api.save).toHaveBeenCalled()); }

it('creates named ideas, searches them, edits metadata, deletes and restores the whole graph', async () => {
  api.read.mockResolvedValue({ revision: 'missing', state: empty }); renderWorkspace();
  await screen.findByText('为每个研究问题建立一张画布。从论文中复用卡片，连接问题、方法与证据，逐步形成可讨论的方向。');
  fireEvent.click(screen.getAllByRole('button', { name: '新建构思' })[0]);
  fireEvent.change(screen.getByLabelText('构思名称'), { target: { value: '缺失数据研究' } });
  fireEvent.change(screen.getByLabelText('研究问题或目标（可选）'), { target: { value: '缺失率变化导致性能不稳定' } });
  fireEvent.click(screen.getByText('创建构思'));
  await screen.findByRole('heading', { name: '缺失数据研究' });
  fireEvent.click(screen.getByLabelText('编辑构思名称与说明'));
  fireEvent.change(screen.getByLabelText('构思名称'), { target: { value: '鲁棒预测' } });
  fireEvent.click(screen.getByText('保存名称与说明'));
  openPanel('构思列表');
  fireEvent.change(screen.getByLabelText('搜索构思'), { target: { value: '不匹配' } });
  expect(screen.getByText('没有匹配的构思，试试其他关键词。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索构思'), { target: { value: '' } });
  fireEvent.keyDown(screen.getByLabelText('管理构思 鲁棒预测'), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '移到已删除' }));
  expect(screen.queryByLabelText('构思画布')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '已删除 (1)' }));
  fireEvent.click(screen.getByText('恢复'));
  await screen.findByLabelText('构思画布');
  await save(); expect(savedState().boards[0]).toMatchObject({ title: '鲁棒预测', deleted_at: null, description: '缺失率变化导致性能不稳定' });
});

it('creates a personal problem without a source paper or assistant prompt', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [], placements: [] } });
  renderWorkspace();
  await screen.findByLabelText('构思画布'); openCards();
  fireEvent.click(screen.getByRole('button', { name: '新建卡片' }));
  fireEvent.change(screen.getByLabelText('卡片标题'), { target: { value: '缺失率变化' } });
  fireEvent.change(screen.getByLabelText('卡片内容'), { target: { value: '模型性能不稳定' } });
  fireEvent.click(screen.getByText('添加卡片并加入方案'));
  expect(within(canvas()).getByRole('button', { name: '缺失率变化' })).toBeTruthy();
  expect(screen.queryByText('与助手讨论')).toBeNull();
  await save(); expect(savedState().cards[0]).toMatchObject({ entry_id: 'ideation-user', title: '缺失率变化' });
});

it('shows read-only details, branches the same source card, and switches independent idea graphs', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(canvas()).getByRole('button', { name: '查看卡片详情 研究问题' }));
  expect(within(screen.getByLabelText('卡片详情')).queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByText('固定此卡片'));
  expect((within(canvas()).getByLabelText('使用方向键移动 研究问题') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('复制为分支'));
  expect(within(screen.getByLabelText('卡片详情')).queryByRole('textbox')).toBeNull();
  expect(within(canvas()).getByRole('button', { name: '研究问题（分支）' })).toBeTruthy();
  openPanel('构思列表'); fireEvent.click(within(screen.getByRole('region', { name: '构思列表面板' })).getByText('构思乙'));
  expect(within(canvas()).getByText('缺少对照')).toBeTruthy();
  expect(within(canvas()).queryByText('仅适用于构思甲')).toBeNull();
  await save();
  expect(savedState().cards).toHaveLength(2); expect(savedState().cards[0].body).toBe('缺少对照');
  expect(savedState().placements).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'p1', locked: true }), expect.objectContaining({ title: '研究问题（分支）', card_id: 'c2', board_id: 'a' })]));
});

it('drags library cards, connects nodes and edits direction, labels and reasoning', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [method, problem], placements: [] } });
  renderWorkspace(); await screen.findByLabelText('构思画布'); openCards();
  vi.spyOn(canvas(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 } as DOMRect);
  for (const [id, x, kind] of [['c1', 200, 'method'], ['c2', 600, 'problem']] as const) {
    act(() => { ideationCardDrag.begin({ workspaceRoot: 'workspace', boardId: 'legacy-board', data: `card:${id}`, title: '', kind, x, y: 150 }, x, 150); ideationCardDrag.finish(x, 150); });
  }
  const source = within(canvas()).getByRole('button', { name: '反事实方法' }).closest('article')!;
  fireEvent.click(within(source).getByText('连接'));
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  expect(screen.getByLabelText('关系详情')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('关系名称（可自定义）'), { target: { value: '尝试减少偏差' } });
  fireEvent.change(screen.getByLabelText('逻辑描述／输入输出约定'), { target: { value: '先验证条件是否成立' } });
  fireEvent.click(screen.getByText('反转箭头方向'));
  fireEvent.click(screen.getByLabelText('关闭详情'));
  fireEvent.keyDown(within(canvas()).getByRole('button', { name: /编辑关系：研究问题 → 尝试减少偏差 → 反事实方法/ }), { key: 'Enter' });
  expect(screen.getByLabelText('关系详情')).toBeTruthy();
  await save(); expect(savedState().links[0]).toMatchObject({ kind: 'related', label: '尝试减少偏差', description: '先验证条件是否成立', origin: 'user' });
  fireEvent.click(screen.getByText('移除关系')); expect(canvas().querySelectorAll('[data-testid^="relation-"]')).toHaveLength(0);
  fireEvent.click(screen.getByText('撤销移除')); expect(canvas().querySelectorAll('[data-testid^="relation-"]')).toHaveLength(1);
});

it('preserves failed saves and allows keyboard movement, removal and undo', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [method], placements: [{ id: 'p1', card_id: 'c1', x: 10, y: 10 }] } });
  api.save.mockRejectedValue('版本冲突'); renderWorkspace();
  const move = await screen.findByRole('button', { name: '使用方向键移动 反事实方法' });
  const x = Number.parseFloat(move.closest('article')!.style.left);
  fireEvent.keyDown(move, { key: 'ArrowRight' }); expect(move.closest('article')?.style.left).toBe(`${x + 20}px`);
  await save(); await screen.findByRole('alert'); expect(screen.getByText(/版本冲突/)).toBeTruthy();
  fireEvent.click(within(canvas()).getByRole('button', { name: '查看卡片详情 反事实方法' }));
  fireEvent.click(screen.getByText('从此构思移除')); expect(canvas().querySelectorAll('article')).toHaveLength(0);
  fireEvent.click(screen.getByText('撤销移除')); expect(within(canvas()).getByRole('button', { name: '反事实方法' })).toBeTruthy();
});

it('starts from an existing problem, recommends typed branches and fills a slot with a correctly directed relation', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [method, problem], placements: [] } });
  const show = vi.fn(); renderWorkspace(show);
  fireEvent.click(await screen.findByRole('button', { name: '从已有问题开始' })); expect(show).toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: '筛选卡片类型' }).textContent).toContain('研究问题');
  expect(screen.getByRole('button', { name: '创建空白研究问题' })).toBeTruthy();
  expect(screen.queryByTestId('library-card-c1')).toBeNull();
  fireEvent.click(within(screen.getByTestId('library-card-c2')).getByText('加入方案'));
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  expect(screen.getAllByRole('button', { name: /^分支选项：/ })).toHaveLength(4);
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(0);
  expect(screen.queryByLabelText('卡片详情')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(1);
  expect(screen.queryByRole('dialog', { name: '选择下一步' })).toBeNull();
  const methodSlot = canvas().querySelector<HTMLElement>('[data-branch-slot]')!;
  const originalSlotStyle = methodSlot.getAttribute('style');
  expect(methodSlot.style.height).toBe(canvas().querySelector<HTMLElement>('article')!.style.height);
  fireEvent.click(screen.getByRole('button', { name: '选择分支 研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：补充约束' }));
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(2);
  expect(canvas().querySelector('[data-branch-slot]')?.getAttribute('style')).toBe(originalSlotStyle);
  fireEvent.click(screen.getByRole('button', { name: '选择分支 研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  expect(screen.queryByTestId('library-card-c2')).toBeNull();
  expect(screen.queryByTestId('library-card-preset-add')).toBeNull();
  fireEvent.click(within(screen.getByTestId('library-card-c1')).getByText('填入空位'));
  await save();
  const graph = savedState(), from = graph.placements.find((p: any) => p.card_id === 'c1'), to = graph.placements.find((p: any) => p.card_id === 'c2');
  expect(graph.placements).toHaveLength(2);
  expect(graph.links).toEqual([expect.objectContaining({ from: from.id, to: to.id, kind: 'addresses', origin: 'user' })]);
  expect(api.search).not.toHaveBeenCalled();
});

it('rejects an incompatible drag into a typed slot without changing the graph', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  fireEvent.drop(within(canvas()).getByRole('button', { name: '下一步：尝试已有方法' }), { dataTransfer: { getData: () => 'card:c2' } });
  expect(await screen.findByText('请先确认 AI 卡片，并选择适合此空位的类型。')).toBeTruthy();
  expect(canvas().querySelectorAll('article')).toHaveLength(2);
  expect(canvas().querySelectorAll('[data-testid^="relation-"]')).toHaveLength(0);
});

it('opens saved drafts in a dialog, verifies evidence, and accepts only selected edited cards', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [], placements: [] } });
  api.summaries = [{ entry_id: 'paper-1', status: 'ready', cards: [{ id: 'd1', kind: 'method', title: '原始方法' }] }];
  const evidence = [{ segment_uid: 'seg-1', page_idx: 2, quote: '原文片段' }];
  api.draft.mockResolvedValue({ revision: 'd1', draft: { entry_id: 'paper-1', status: 'ready', model: '测试模型', partial: true, cards: [
    { id: 'd1', entry_id: 'paper-1', kind: 'method', title: '原始方法', body: '机制说明', sources: evidence },
    { id: 'd2', entry_id: 'paper-1', kind: 'assumption', title: '假设', body: '假设说明', sources: [] }
  ] } });
  api.source.mockResolvedValue({ entry_id: 'paper-1', segment_uid: 'seg-1', page_idx: 2, text: '原文片段及其上下文' });
  const open = vi.fn(); renderWorkspace(vi.fn(), open); await screen.findByLabelText('构思画布'); openCards();
  fireEvent.click(screen.getByText('原始方法')); await screen.findByText(/仅分析了部分正文/);
  fireEvent.click(screen.getByText('核对原文 · 第 3 页')); await waitFor(() => expect(open).toHaveBeenCalledWith({ sourceEntryId: 'paper-1', page: 3, segmentUid: 'seg-1' }));
  fireEvent.change(screen.getByLabelText('草稿标题 d1'), { target: { value: '已修改的方法' } });
  fireEvent.click(within(screen.getByLabelText('AI 卡片草稿')).getAllByRole('checkbox')[1]);
  fireEvent.click(screen.getByText('确认并保存所选卡片')); await save();
  expect(savedState().cards).toEqual([expect.objectContaining({ title: '已修改的方法', sources: evidence, origin: 'ai_reviewed' })]);
});

it('keeps an asynchronous draft drop attached to its original board after a switch', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() });
  api.summaries = [{ entry_id: 'paper-1', status: 'ready', cards: [{ id: 'd1', kind: 'method', title: '迟到方法', origin: 'ai_reviewed' }] }];
  let resolve!: (value: unknown) => void; api.draft.mockImplementation(() => new Promise(done => { resolve = done; }));
  renderWorkspace(); await screen.findByLabelText('构思画布'); openCards();
  fireEvent.click(within(screen.getByTestId('library-card-d1')).getByText('加入方案'));
  openPanel('构思列表');
  openPanel('构思列表'); fireEvent.click(within(screen.getByRole('region', { name: '构思列表面板' })).getByText('构思乙'));
  resolve({ draft: { status: 'ready', cards: [{ id: 'd1', entry_id: 'paper-1', title: '迟到方法', body: '机制', kind: 'method', origin: 'ai_reviewed' }] } });
  await waitFor(() => expect(api.save).toHaveBeenCalled(), { timeout: 2500 });
  expect(within(canvas()).queryByText('迟到方法')).toBeNull();
  expect(savedState().placements.find((p: any) => p.card_id === 'd1').board_id).toBe('a');
  expect(savedState().cards.find((c: any) => c.id === 'c1').body).toBe(method.body);
});

it('adds a whole extracted structure while keeping the inferred relation evidence', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [], placements: [] } });
  const evidence = [{ segment_uid: 'seg-1', page_idx: 2, quote: '原文片段' }];
  api.summaries = [{ entry_id: 'paper-1', status: 'ready', cards: [{ id: 'd1', kind: 'problem', title: '待解决问题' }] }];
  api.draft.mockResolvedValue({ draft: { entry_id: 'paper-1', status: 'ready', model: 'model', partial: true,
    cards: [{ id: 'd1', entry_id: 'paper-1', kind: 'problem', title: '待解决问题', body: '困难', sources: evidence }, { id: 'd2', entry_id: 'paper-1', kind: 'component', title: '方法组件', body: '处理操作', sources: evidence }],
    relations: [{ from: 'd2', to: 'd1', kind: 'addresses', sources: evidence }] } });
  renderWorkspace(); await screen.findByLabelText('构思画布'); openCards(); fireEvent.click(screen.getByText('待解决问题'));
  fireEvent.click(await screen.findByText('确认并加入方案')); await save();
  expect(savedState().links).toEqual([expect.objectContaining({ kind: 'addresses', origin: 'ai_inferred', entry_id: 'paper-1', sources: evidence })]);
  expect(savedState().placements.every((p: any) => p.board_id === 'legacy-board')).toBe(true);
});

it('preserves unfinished manual input when closing and reopening its dialog', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [], placements: [] } });
  renderWorkspace(); await screen.findByLabelText('构思画布'); openCards();
  fireEvent.click(screen.getByRole('button', { name: '新建卡片' }));
  fireEvent.change(screen.getByLabelText('卡片内容'), { target: { value: '我的理解' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: '新建卡片' }));
  expect((screen.getByLabelText('卡片内容') as HTMLTextAreaElement).value).toBe('我的理解');
});

it('previews the unchanged library source even after selecting an edited node of the same card', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布'); openCards();
  fireEvent.click(within(canvas()).getByRole('button', { name: '查看卡片详情 研究问题' }));
  expect(within(screen.getByLabelText('卡片详情')).queryByRole('textbox')).toBeNull();
  fireEvent.click(within(screen.getByTestId('library-card-c2')).getByRole('button', { name: '研究问题' }));
  expect(within(screen.getByLabelText('卡片详情')).getByText('缺少对照')).toBeTruthy();
  expect(within(screen.getByLabelText('卡片详情')).queryByLabelText('内容')).toBeNull();
});

it('shows a retry after read failure without creating a replacement graph', async () => {
  api.read.mockRejectedValueOnce('读取失败').mockResolvedValueOnce({ revision: 'r1', state: twoBoards() });
  renderWorkspace(); fireEvent.click((await screen.findAllByRole('button', { name: '重新读取' }))[0]);
  await screen.findByLabelText('构思画布'); expect(api.save).not.toHaveBeenCalled();
});

it('stays on the canvas when selecting an idea and exposes no assistant action', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() });
  const sidebar = vi.fn(); renderWorkspace(sidebar);
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(screen.getByRole('region', { name: '构思列表面板' })).getByText('构思乙'));
  expect(sidebar).not.toHaveBeenCalled(); expect(screen.queryByText('与助手讨论')).toBeNull();
  expect(screen.getByRole('heading', { name: '构思乙' })).toBeTruthy();
  expect(within(canvas()).queryByText('反事实方法')).toBeNull();
});

it('lays out the requested slot, keeps edits stable, and restores filled coordinates', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { ...twoBoards(), links: [{ id: 'relation', from: 'p2', to: 'p1', kind: 'addresses' }] } });
  renderWorkspace(); await screen.findByLabelText('构思画布');
  const article = (id: string) => canvas().querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
  expect(Number.parseFloat(article('p1').style.left)).toBeLessThan(Number.parseFloat(article('p2').style.left));
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  const x = Number.parseFloat(article('p1').style.left);
  fireEvent.keyDown(within(article('p1')).getByLabelText('使用方向键移动 研究问题'), { key: 'ArrowRight' });
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(1);
  const arrangedX = article('p1').style.left;
  expect(arrangedX).toBe(`${x + 20}px`);
  fireEvent.click(within(article('p1')).getByLabelText('查看卡片详情 研究问题'));
  expect(within(screen.getByLabelText('卡片详情')).queryByRole('textbox')).toBeNull();
  expect(article('p1').style.left).toBe(arrangedX);
  fireEvent.click(screen.getByLabelText('关闭详情'));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(1);
  const slot = canvas().querySelector<HTMLElement>('[data-branch-slot="method"]')!;
  const position = { x: Number.parseFloat(slot.style.left), y: Number.parseFloat(slot.style.top) };
  const arrangedPositions = ['p1', 'p2'].map(id => ({ id, x: Number.parseFloat(article(id).style.left), y: Number.parseFloat(article(id).style.top) }));
  const transform = article('p1').parentElement!.style.transform;
  fireEvent.click(within(screen.getByTestId('library-card-c1')).getByText('填入空位'));
  expect(article('p1').parentElement!.style.transform).toBe(transform);
  expect(canvas().querySelector('[data-branch-slot="method"]')).toBeNull();
  await save();
  const current = savedState(), placed = current.placements.filter((p: any) => p.board_id === 'a');
  expect(placed).toHaveLength(3);
  expect(placed.find((p: any) => p.id === 'p1')).toMatchObject({ ...arrangedPositions[0] });
  expect(placed.find((p: any) => p.id === 'p2')).toMatchObject(arrangedPositions[1]);
  const filled = placed.find((p: any) => !['p1', 'p2'].includes(p.id));
  expect(filled).toMatchObject(position);
  expect(placed.every((p: any) => p.card_id)).toBe(true);
  expect(current.links).toHaveLength(2);
  cleanup(); api.read.mockResolvedValue({ revision: 'saved', state: current }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  expect(article(filled.id).style.left).toBe(`${position.x}px`);
  expect(article(filled.id).style.top).toBe(`${position.y}px`);
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  expect(canvas().querySelector('[data-branch-slot="method"]')).not.toBeNull();
});

it('keeps selection on blank canvas clicks, and toggles it only on the selected node or Escape', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  const problemNode = within(canvas()).getByRole('button', { name: '研究问题' });
  fireEvent.click(problemNode);
  expect(screen.getByRole('dialog', { name: '选择下一步' })).toBeTruthy();
  expect(within(screen.getByLabelText('研究构思侧栏')).queryByText('选择下一步')).toBeNull();
  fireEvent.pointerDown(canvas(), { button: 0, clientX: 900, clientY: 600 });
  fireEvent.pointerUp(canvas()); fireEvent.click(canvas());
  expect(problemNode.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(problemNode);
  expect(problemNode.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('dialog', { name: '选择下一步' })).toBeNull();
  fireEvent.click(problemNode); fireEvent.keyDown(canvas(), { key: 'Escape' });
  expect(problemNode.getAttribute('aria-pressed')).toBe('false');
});

it('removes a canvas card directly, preserves the library card and supports undo', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(canvas()).getByRole('button', { name: '从画布移除 反事实方法' }));
  expect(within(canvas()).queryByRole('button', { name: '反事实方法' })).toBeNull();
  await save(); expect(savedState().cards.some((c: any) => c.id === 'c1')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));
  expect(within(canvas()).getByRole('button', { name: '反事实方法' })).toBeTruthy();
});

it('clicking the same empty slot resets a stale candidate search', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  const search = screen.getByRole('textbox', { name: '搜索卡片' });
  fireEvent.change(search, { target: { value: '没有这样的候选' } });
  expect(screen.queryByTestId('library-card-c1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一步：尝试已有方法' }));
  await waitFor(() => expect((search as HTMLInputElement).value).toBe(''));
  expect(screen.getByTestId('library-card-c1')).toBeTruthy();
  expect(screen.queryByTestId('library-card-c2')).toBeNull();
});

it('opens the source paper card manager when reviewing an unconfirmed library card', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: { version: 1, cards: [{ ...method, origin: 'ai_draft' }], placements: [] } });
  const open = vi.fn(); renderWorkspace(vi.fn(), vi.fn(), open);
  await screen.findByLabelText('构思画布'); openCards();
  fireEvent.click(screen.getByRole('button', { name: '前往核对' }));
  expect(open).toHaveBeenCalledWith('paper-1');
  expect(canvas().querySelectorAll('article')).toHaveLength(0);
});

it('opens the workspace when selecting an idea and honors blocked navigation', async () => {
  api.read.mockResolvedValue({ revision: 'saved', state: twoBoards() });
  const open = vi.fn(() => false);
  render(<TooltipProvider><IdeationProvider root="workspace" onOpenWorkspace={open}>
    <IdeationSidebar root="workspace" entries={[entry]} onOpenEntry={vi.fn()} onOpenSource={vi.fn()} />
    <IdeationWorkspace root="workspace" entries={[entry]} onOpenEntry={vi.fn()} />
  </IdeationProvider></TooltipProvider>);
  await screen.findByRole('heading', { name: '构思甲' });
  fireEvent.click(screen.getByRole('button', { name: /构思乙.*张已选卡片/ }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: '构思甲' })).toBeTruthy();
  open.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: /构思乙.*张已选卡片/ }));
  expect(open).toHaveBeenCalledTimes(2);
  await screen.findByRole('heading', { name: '构思乙' });
});

it('zooms the canvas around the pointer with the wheel', async () => {
  api.read.mockResolvedValue({ revision: 'saved', state: twoBoards() }); renderWorkspace();
  const area = await screen.findByLabelText('构思画布');
  const before = Number(screen.getByRole('button', { name: '恢复百分之百缩放' }).textContent?.replace('%', ''));
  fireEvent.wheel(area, { deltaY: -100, clientX: 100, clientY: 100 });
  const after = Number(screen.getByRole('button', { name: '恢复百分之百缩放' }).textContent?.replace('%', ''));
  expect(after).toBeGreaterThan(before);
  fireEvent.wheel(area, { deltaY: 100, clientX: 100, clientY: 100 });
  expect(Number(screen.getByRole('button', { name: '恢复百分之百缩放' }).textContent?.replace('%', ''))).toBe(before);
});

it('fills a slot with private content without publishing it to the card library', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  fireEvent.click(screen.getByRole('button', { name: '直接填写' }));
  fireEvent.change(screen.getByLabelText('本构思内容标题'), { target: { value: '私有方法' } });
  fireEvent.change(screen.getByLabelText('本构思内容正文'), { target: { value: '仅在当前研究尝试' } });
  fireEvent.click(screen.getByRole('button', { name: '保存到本构思' }));
  expect(within(canvas()).getByRole('button', { name: '私有方法' })).toBeTruthy();
  expect(screen.queryByTestId(/library-card-local-idea/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看卡片详情 私有方法' }));
  fireEvent.change(screen.getByLabelText('本构思内容正文'), { target: { value: '修改后的私有内容' } });
  fireEvent.click(screen.getByRole('button', { name: '保存到本构思' }));
  await save();
  expect(savedState().placements.some((p: any) => p.body === '修改后的私有内容' && p.board_id === 'a')).toBe(true);
  openPanel('构思列表'); fireEvent.click(screen.getByRole('button', { name: /构思乙.*张已选卡片/ }));
  expect(within(canvas()).queryByRole('button', { name: '私有方法' })).toBeNull();
});

it('retains empty slots across reopening and allows explicit deletion', async () => {
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); const view = renderWorkspace();
  await screen.findByLabelText('构思画布');
  fireEvent.click(within(canvas()).getByRole('button', { name: '研究问题' }));
  fireEvent.click(screen.getByRole('button', { name: '分支选项：尝试已有方法' }));
  view.unmount(); renderWorkspace(); await screen.findByLabelText('构思画布');
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '删除空位 尝试已有方法' }));
  expect(canvas().querySelectorAll('[data-branch-slot]')).toHaveLength(0);
});

it('does not save when resize automatically fits the canvas', async () => {
  const callbacks: (() => void)[] = [];
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} unobserve() {} disconnect() {} });
  api.read.mockResolvedValue({ revision: 'r1', state: twoBoards() }); renderWorkspace();
  await screen.findByLabelText('构思画布');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
  api.save.mockClear();
  act(() => { callbacks.forEach(callback => callback()); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
  expect(api.save).not.toHaveBeenCalled();
});
