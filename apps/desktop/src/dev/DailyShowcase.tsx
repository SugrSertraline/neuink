import { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceTabsBar } from '@/app/WorkspaceTabsBar';
import { ActivityNavigation } from '@/app/ActivityNavigation';
import type { SidePanel } from '@/app/activityBarState';
import { EmptyWorkspace } from '@/app/EmptyWorkspace';
import { AppearanceProvider, useAppearance } from '@/shared/components/AppearanceProvider';
import { initialWorkspaceSurfaceLayout, surfaceKey, workspaceSurfaceReducer, type WorkspaceSurface, type WorkspacePaneId } from '@/app/workspaceSurface';
import { WorkspaceSurfaceDeck } from '@/modules/reader/components/WorkspaceSurfaceDeck';
import { DailyDashboardView } from '@/modules/daily/DailyDashboard';
import '../styles/globals.css';

import { entries, states } from './dailyReadingFixture';

function DailyShowcase() {
  const { appearance, setAppearance } = useAppearance();
  const [layout, dispatch] = useReducer(workspaceSurfaceReducer, workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'daily-dashboard' } }));
  const [status, setStatus] = useState<'ready' | 'loading' | 'error' | 'empty'>('ready');
  const [activePanel, setActivePanel] = useState<SidePanel | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [scale, setScale] = useState(1);
  const open = (surface: WorkspaceSurface, pane?: WorkspacePaneId) => dispatch({ type: 'open', surface, pane });
  const openActivityPage = (page: 'library' | 'daily-dashboard' | 'settings', pane?: WorkspacePaneId) => {
    open({ kind: page }, pane);
    if (page !== 'settings') setActivePanel(page);
  };
  return <TooltipProvider><div className="flex min-h-0 flex-col bg-background" style={{ height: `${100 / scale}vh` }}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
      <span>隔离检查 · 示例数据</span>
      <Button size="sm" variant={appearance === 'atelier' ? 'secondary' : 'outline'} onClick={() => setAppearance(appearance === 'atelier' ? 'standard' : 'atelier')}>{appearance === 'atelier' ? '切换普通主题' : '切换拟物主题'}</Button>
      {(['ready', 'loading', 'error', 'empty'] as const).map((state, index) => <Button size="sm" variant={status === state ? 'secondary' : 'outline'} key={state} onClick={() => setStatus(state)}>{['正常', '加载', '失败', '空数据'][index]}</Button>)}
      <Button size="sm" variant="outline" onClick={() => setLegacy(!legacy)}>{legacy ? '恢复分段' : '旧记录'}</Button>
      <Button size="sm" variant="outline" onClick={() => open({ kind: 'pdf', entryId: entries[0].id }, 'right')}>并排阅读</Button>
      <Button size="sm" variant="outline" onClick={() => setNarrow(!narrow)}>{narrow ? '恢复宽度' : '窄面板'}</Button>
      {[1, 1.25].map(value => <Button key={value} size="sm" variant="outline" onClick={() => { document.documentElement.style.zoom = String(value); setScale(value); window.dispatchEvent(new Event('resize')); }}>{value * 100}%</Button>)}
    </div>
    <div className="flex min-h-0 flex-1">
      <ActivityNavigation focusedKind={(layout.focusedPane === 'right' ? layout.right ?? layout.left : layout.left).kind}
        activePanel={activePanel} noteDetails={false} onOpenPage={openActivityPage} onOpenRight={page => openActivityPage(page, 'right')}
        onSelectTool={setActivePanel} />
      {activePanel ? <aside className="w-48 shrink-0 border-r bg-card p-3 text-sm">侧栏检查占位 · {activePanel}</aside> : null}
      <div className="flex min-h-0 min-w-0 flex-col border-r" style={{ width: narrow ? 'min(100%, 340px)' : '100%' }}>
        <WorkspaceTabsBar entries={entries} layout={layout}
          onClose={(pane, surface) => dispatch({ type: 'close', pane, key: surfaceKey(surface) })}
          onCloseOthers={(pane, surface) => dispatch({ type: 'closeOthers', pane, key: surfaceKey(surface) })}
          onClosePane={pane => dispatch({ type: 'closePane', pane })}
          onMove={(surface, pane, targetIndex) => dispatch({ type: 'move', key: surfaceKey(surface), pane, targetIndex })}
          onSetPinned={(surface, pinned) => dispatch({ type: 'setPinned', key: surfaceKey(surface), pinned })}
          onSelect={(pane, surface) => open(surface, pane)} onSwap={() => dispatch({ type: 'swap' })} />
        <div className={`workspace-split min-h-0 flex-1 ${layout.right ? 'is-split' : ''}`} style={{ gridTemplateColumns: layout.right ? 'minmax(0, 1fr) 1px minmax(0, 1fr)' : 'minmax(0, 1fr)' }}>
          <WorkspaceSurfaceDeck layout={layout} onFocus={pane => dispatch({ type: 'focus', pane })} renderSurface={surface => surface.kind === 'empty'
            ? <EmptyWorkspace onOpen={open} /> : surface.kind === 'daily-dashboard'
              ? <DailyDashboardView entries={status === 'empty' ? [] : entries} states={legacy ? Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { ...state, reading_sessions: undefined }])) : states} loading={status === 'loading'} error={status === 'error' ? '阅读记录读取失败，请重试。' : null}
                  onRetry={() => setStatus('ready')} onOpenLibrary={() => open({ kind: 'library' })} onOpenEntry={entryId => open({ kind: 'pdf', entryId })} />
              : <div className="h-full overflow-auto bg-card p-4"><h1 className="text-base">{surface.kind === 'library' ? '条目库检查占位' : '阅读页面检查占位'}</h1><p className="mt-3 text-sm text-muted-foreground">用于核对标签页关闭、分栏及看板状态保留。</p></div>} />
        </div>
      </div>
    </div>
  </div></TooltipProvider>;
}

createRoot(document.getElementById('root')!).render(<AppearanceProvider><DailyShowcase /></AppearanceProvider>);
