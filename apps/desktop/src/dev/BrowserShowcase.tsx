import { useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Library, PanelRight } from 'lucide-react';
import { WorkspaceTabsBar } from '@/app/WorkspaceTabsBar';
import { initialWorkspaceSurfaceLayout, surfaceKey, workspaceSurfaceReducer } from '@/app/workspaceSurface';
import { BrowserSurface } from '@/modules/browser/BrowserSurface';
import { AppearanceIcon } from '@/shared/components/AppearanceIcon';
import { AppearanceProvider, useAppearance } from '@/shared/components/AppearanceProvider';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/styles/globals.css';

// Isolated visual fixture: no Workspace, files, credentials or model calls.
function Showcase() {
  const [layout, dispatch] = useReducer(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);
  const [narrow, setNarrow] = useState(false);
  const { setAppearance } = useAppearance();
  return <main className="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header className="flex flex-wrap items-center gap-2 border-b p-2">
      <span>网页标签隔离验收</span>
      <Button onClick={() => setAppearance('standard')}>标准</Button>
      <Button onClick={() => setAppearance('atelier')}>拟物</Button>
      <Button onClick={() => setNarrow(v => !v)}>切换窄宽</Button>
      <span className="flex items-center gap-1"><AppearanceIcon kind="library"><Library size={20} /></AppearanceIcon>条目库</span>
      <span className="flex items-center gap-1"><AppearanceIcon kind="details"><PanelRight size={20} /></AppearanceIcon>条目详情</span>
    </header>
    <div className="min-w-0 border-b" style={{ width: narrow ? 360 : '100%' }}>
      <WorkspaceTabsBar layout={layout} entries={[]}
        onNewBrowser={() => dispatch({ type: 'open', surface: { kind: 'browser', id: crypto.randomUUID() } })}
        onClose={(pane, surface) => dispatch({ type: 'close', pane, key: surfaceKey(surface) })}
        onCloseOthers={(pane, surface) => dispatch({ type: 'closeOthers', pane, key: surfaceKey(surface) })}
        onClosePane={pane => dispatch({ type: 'closePane', pane })}
        onMove={(surface, pane, targetIndex) => dispatch({ type: 'move', pane, key: surfaceKey(surface), targetIndex })}
        onSelect={(pane, surface) => dispatch({ type: 'open', pane, surface })}
        onSwap={() => dispatch({ type: 'swap' })} />
    </div>
    <div className="flex min-h-0 flex-1" style={{ width: narrow ? 360 : '100%' }}>
      {(['left', 'right'] as const).map(pane => {
        const surface = layout[pane];
        return surface && <div key={pane} className="min-w-0 flex-1 border-r" onPointerDown={() => dispatch({ type: 'focus', pane })}>
          {surface.kind === 'browser' ? <BrowserSurface key={surface.id} id={surface.id} active initialUrl={surface.url}
            onChange={(url, title) => dispatch({ type: 'updateBrowser', id: surface.id, url, title })} />
            : <p className="p-4">使用标签栏的“＋”打开网页，不连接真实资料库。</p>}
        </div>;
      })}
    </div>
  </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<AppearanceProvider><TooltipProvider><Showcase /></TooltipProvider></AppearanceProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
