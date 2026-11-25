import { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActivityNavigation } from '@/app/ActivityNavigation';
import { WorkspaceTabsBar } from '@/app/WorkspaceTabsBar';
import { WorkspaceSidebar, SidebarPanelSlot } from '@/app/WorkspaceSidebar';
import { useWorkspaceNavigation } from '@/app/useWorkspaceNavigation';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceReducer } from '@/app/workspaceSurface';
import type { SidePanel } from '@/app/activityBarState';
import { DailyProvider } from '@/modules/daily/DailyContext';
import { DailySidebar } from '@/modules/daily/DailySidebar';
import { DailyDashboardView } from '@/modules/daily/DailyDashboard';
import { ResearchPaperActionsProvider } from '@/modules/assistant/components/ResearchPaperActions';
import type { PaperLibraryEntry } from '@/modules/assistant/research/libraryPaperMatch';
import { ToastProvider } from '@/shared/components/ToastProvider';
import { entries, states } from './dailyReadingFixture';
import { installDailyFixture, fixture } from './dailyFixture';
import '../styles/globals.css';
installDailyFixture();
const localPreviewEntries: PaperLibraryEntry[] = entries.slice(0, 2).map((entry, index) => ({
  id: entry.id, title: entry.title, fields: { research_id: index === 0 ? 'arxiv:2006.11239v2' : 'fixture-0' },
  pdf: index === 0 ? { file_name: 'example.pdf', content_hash: '', imported_at: '', parse: { status: 'not_started', updated_at: '', message: null, task_id: null, endpoint: null } } : null,
}));
function Preview() {
  const [layout, dispatch] = useReducer(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);
  const [panel, setPanel] = useState<SidePanel>('library');
  const [narrow, setNarrow] = useState(false), [scale, setScale] = useState(1);
  const open = useWorkspaceNavigation({ layout, dispatch, prepareSplit: () => {}, onBlockedMove: () => {}, onSelectPage: setPanel });
  const [empty, setEmpty] = useState(false);
  const [opened, setOpened] = useState('');
  return <ToastProvider><TooltipProvider><ResearchPaperActionsProvider root="fixture-only" entries={localPreviewEntries} onOpenEntry={setOpened}><DailyProvider root="fixture-only" openNote={() => {}}>
    <div className="flex flex-col bg-background" style={{ height: `${100 / scale}vh` }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs"><span>隔离检查 · 示例数据</span>
        <Button size="sm" onClick={() => setNarrow(v => !v)}>{narrow ? '恢复宽度' : '窄面板'}</Button>
        <Button size="sm" onClick={() => { const next = scale === 1 ? 1.25 : 1; setScale(next); document.documentElement.style.zoom = String(next); }}>{scale === 1 ? '125%' : '100%'}</Button>
        <Button size="sm" onClick={() => setEmpty(v => !v)}>{empty ? '恢复数据' : '空数据'}</Button>
        <Button size="sm" onClick={() => { fixture.fail = !fixture.fail; }}>切换推荐失败</Button>
        {opened ? <span role="status">本地打开入口：{opened}（隔离示例）</span> : null}
      </div>
      <div className="app-shell min-h-0 flex-1" style={{ gridTemplateColumns: `48px 260px minmax(0, ${narrow ? '360px' : '1fr'})` }}>
        <WorkspaceTabsBar entries={entries} layout={layout} onSelect={(pane, surface) => open(surface, pane)} onClose={() => {}} onCloseOthers={() => {}} onClosePane={() => {}} onMove={() => {}} onSwap={() => {}} />
        <ActivityNavigation focusedKind={layout.left.kind} activePanel={panel} noteDetails={false} onOpenPage={page => open({ kind: page })} onOpenRight={page => open({ kind: page })} onSelectTool={setPanel} />
        <WorkspaceSidebar open>
          <SidebarPanelSlot active={panel === 'daily-dashboard'}><DailySidebar active={panel === 'daily-dashboard'} entries={entries} onOpenRecommendations={() => document.getElementById('daily-recommendations')?.scrollIntoView()} /></SidebarPanelSlot>
          {panel === 'library' ? <aside className="app-sidebar" aria-label="条目库目录"><div className="side-head">条目库</div><div className="space-y-4 p-4 text-sm"><p>全部论文</p><p>未解析 PDF</p><p>研究标签</p><p>隔离目录占位；检查与看板的显示切换。</p></div></aside> : null}
          <SidebarPanelSlot active={panel === 'assistant'}><aside className="app-sidebar" aria-label="助手侧栏"><div className="side-head">助手</div><textarea aria-label="对话草稿" placeholder="切换页面后草稿应保留" className="m-3 min-w-0 border p-2" /></aside></SidebarPanelSlot>
          {!['library', 'daily-dashboard', 'assistant'].includes(panel) ? <aside className="app-sidebar"><div className="side-head">{panel}</div></aside> : null}
        </WorkspaceSidebar>
        <div className="min-h-0 min-w-0" style={{ gridColumn: 3, gridRow: 2 }}>
          <div className={layout.left.kind === 'daily-dashboard' ? 'h-full' : 'hidden'}><DailyDashboardView entries={empty ? [] : entries} states={empty ? {} : states} loading={false} error={null} onRetry={() => {}} onOpenEntry={() => {}} onOpenLibrary={() => open({ kind: 'library' })} /></div>
          {layout.left.kind === 'library' ? <div className="h-full bg-card p-5">条目库 · 点击左侧每日看板检查同步切换</div> : null}
        </div>
      </div>
    </div>
  </DailyProvider></ResearchPaperActionsProvider></TooltipProvider></ToastProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
