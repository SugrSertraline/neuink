import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { IdeationProvider } from '@/modules/ideation/IdeationContext';
import { IdeationSidebar } from '@/modules/ideation/IdeationSidebar';
import { IdeationWorkspace } from '@/modules/ideation/IdeationWorkspace';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import type { IdeationState } from '@/shared/ipc/ideationApi';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import '../styles/globals.css';

if (!import.meta.env.DEV) throw new Error('Development preview only');
const params = new URLSearchParams(location.search);
const entries = [
  { id: 'paper1', title: 'Missing-aware Spatiotemporal Forecasting', tags: ['时空预测', '缺失数据'] },
  { id: 'paper2', title: 'Counterfactual Representation Learning', tags: ['反事实', '鲁棒性'] },
].map(entry => ({ ...entry, tagIds: [], fields: {}, contents: [] })) as unknown as LibraryEntry[];
let state: IdeationState = { version: 2, boards: [
  { id: 'idea1', title: '缺失数据下的鲁棒时空预测', description: '缺失模式变化时，如何减少模型对完整输入的依赖？', created_at: '', updated_at: '2026-10-28' },
  { id: 'idea2', title: '跨场景迁移的表示学习', description: '探索训练场景与实际场景不一致的问题。', created_at: '', updated_at: '2026-10-27' },
], cards: [
  { id: 'c1', entry_id: 'paper1', kind: 'problem', title: '缺失模式变化导致预测不稳定', body: '现有方法依赖较完整的观测序列。在连续缺失和随机缺失之间切换时，误差与不确定性明显增加。' },
  { id: 'c2', entry_id: 'paper1', kind: 'method', title: '拆分时间依赖与空间依赖', body: '分别建模时间连续性与空间关联，再通过条件融合机制汇合两个分支。' },
  { id: 'c3', entry_id: 'paper2', kind: 'method', title: '反事实扰动与对照学习', body: '改变输入中的缺失模式，比较表示变化，检验哪些关联依赖于不稳定的观测条件。' },
  { id: 'c4', entry_id: 'ideation-user', kind: 'idea', title: '引入缺失感知的融合约束', body: '尝试根据缺失模式调节两个分支的贡献。需要检查分支互补是否真的带来收益。' },
  { id: 'c5', entry_id: 'paper1', kind: 'assumption', title: '空间邻域仍提供可用信息', body: '拆分后能否恢复信息，依赖于邻近节点的观测覆盖以及跨节点关系的稳定性。' },
  { id: 'c6', entry_id: 'paper2', kind: 'limitation', title: '合成扰动未必代表真实变化', body: '需验证生成的缺失模式是否覆盖部署场景，不能仅用合成数据推断实际效果。' },
], placements: [
  { id: 'n1', board_id: 'idea1', card_id: 'c1', x: 60, y: 180 },
  { id: 'n2', board_id: 'idea1', card_id: 'c2', x: 470, y: 80 },
  { id: 'n3', board_id: 'idea1', card_id: 'c3', x: 470, y: 400 },
  { id: 'n4', board_id: 'idea1', card_id: 'c4', x: 900, y: 180 },
], links: [
  { id: 'l1', from: 'n2', to: 'n1', kind: 'addresses', origin: 'user' },
  { id: 'l2', from: 'n3', to: 'n2', kind: 'tests', origin: 'user' },
  { id: 'l3', from: 'n2', to: 'n4', kind: 'progression', origin: 'user' },
  { id: 'l4', from: 'n3', to: 'n4', kind: 'combines', origin: 'user', description: '用对照结果约束融合策略，仍需核对适用条件。' },
] };
if (params.has('single')) state = { ...state, placements: [state.placements[0]], links: [] };
if (params.has('empty')) state = { version: 2, cards: [], boards: [], placements: [] };
mockIPC((command, payload) => {
  if (command !== 'ideation_workspace') throw new Error('Isolated preview: no real IPC');
  const action = (payload as { request: { action: { kind: string; state?: IdeationState } } }).request.action;
  if (action.kind === 'read' && params.has('read-error')) throw new Error('示例读取失败');
  if (action.kind === 'save') { if (params.has('save-error')) throw new Error('示例版本冲突'); state = structuredClone(action.state!); }
  return { revision: 'preview', state: structuredClone(state) };
});

function Showcase() {
  const [sidebar, setSidebar] = useState(true);
  const [message, setMessage] = useState('隔离示例 · 不读取本地论文、不调用模型');
  return <TooltipProvider><AppearanceProvider><IdeationProvider root="ideation-preview" onShowSidebar={() => setSidebar(true)}>
    <main className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2"><span className="text-sm font-semibold">Neuink</span><span className="text-xs text-muted-foreground">研究构思 · 交互预览</span><Button size="sm" variant="ghost" onClick={() => setSidebar(value => !value)}>切换侧栏</Button><span className="ml-auto truncate text-xs text-muted-foreground">{message}</span></div>
      <div className="flex min-h-0 flex-1">{sidebar && <div className="h-full w-[300px] shrink-0 border-r"><IdeationSidebar root="ideation-preview" entries={entries} onOpenEntry={() => setMessage('示例：打开来源论文')} onOpenSource={() => setMessage('示例：核对原文')} /></div>}
        <div className="min-w-0 flex-1"><IdeationWorkspace root="ideation-preview" entries={entries} onOpenEntry={() => setMessage('示例：打开来源论文')} /></div>
      </div>
    </main>
  </IdeationProvider></AppearanceProvider></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Showcase />);
