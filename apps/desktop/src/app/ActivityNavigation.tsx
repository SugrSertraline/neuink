import { CalendarDays, Library, ListFilter, MessageSquare, PanelRight, Search, Settings } from 'lucide-react';
import { ActivityButton } from './appSupport';
import { AppearanceIcon } from '@/shared/components/AppearanceIcon';
import type { WorkspaceSurface } from './workspaceSurface';
import { resolveActivityNavigationItem, type SidePanel } from './activityBarState';

const destinations: Array<SidePanel> = ['daily-dashboard', 'library', 'details', 'search', 'same-tag', 'assistant'];

export function ActivityNavigation({ focusedKind, activePanel, noteDetails, onOpenPage, onOpenRight, onSelectTool, onCloseSidebar }: {
  focusedKind: WorkspaceSurface['kind']; activePanel: SidePanel | null; noteDetails: boolean;
  onOpenPage: (page: 'library' | 'daily-dashboard' | 'settings') => void;
  onOpenRight: (page: 'library' | 'daily-dashboard' | 'settings') => void;
  onSelectTool: (panel: SidePanel) => void;
  onCloseSidebar?: () => void;
}) {
  const activeItem = resolveActivityNavigationItem(focusedKind, activePanel);
  const displayedDestinations = destinations;
  const activeIndex = activeItem === null ? -1 : displayedDestinations.indexOf(activeItem);
  const selectTool = (panel: SidePanel) => { if (activePanel === panel) onCloseSidebar?.(); else onSelectTool(panel); };
  const openPage = (page: 'library' | 'daily-dashboard' | 'settings') => {
    if (page !== 'settings' && activePanel === page) { onCloseSidebar?.(); return; }
    if (focusedKind === page && page === 'settings') return;
    onOpenPage(page);
  };
  return <nav className="activitybar" aria-label="主导航" data-navigation="workspace">
    <div className="activitybar-group" role="group" aria-label="工作区导航" data-navigation-group="items">
      <span className="activitybar-slider" aria-hidden="true" data-visible={activeIndex >= 0} style={{ transform: `translateY(${Math.max(0, activeIndex) * 42}px)` }} />
      <ActivityButton kind="navigation" active={activeItem === 'daily-dashboard'} expanded={activePanel === 'daily-dashboard'} label="每日看板" onClick={() => openPage('daily-dashboard')} onContextMenu={() => onOpenRight('daily-dashboard')}>
        <AppearanceIcon kind="calendar"><CalendarDays size={18} aria-hidden="true" /></AppearanceIcon>
      </ActivityButton>
      <ActivityButton kind="navigation" active={activeItem === 'library'} expanded={activePanel === 'library'} label="条目库" onClick={() => openPage('library')} onContextMenu={() => onOpenRight('library')}>
        <AppearanceIcon kind="library"><Library size={18} aria-hidden="true" /></AppearanceIcon>
      </ActivityButton>
      <ActivityButton active={activeItem === 'details'} expanded={activePanel === 'details'} label={noteDetails ? '笔记详情' : '条目详情'} onClick={() => selectTool('details')}>
        <AppearanceIcon kind="details"><PanelRight size={18} aria-hidden="true" /></AppearanceIcon>
      </ActivityButton>
      <ActivityButton active={activeItem === 'search'} expanded={activePanel === 'search'} label="搜索" onClick={() => selectTool('search')}>
        <AppearanceIcon kind="search"><Search size={18} aria-hidden="true" /></AppearanceIcon>
      </ActivityButton>
      <ActivityButton active={activeItem === 'same-tag'} expanded={activePanel === 'same-tag'} label="标签阅读" onClick={() => selectTool('same-tag')}>
        <AppearanceIcon kind="tags"><ListFilter size={18} aria-hidden="true" /></AppearanceIcon>
      </ActivityButton>
      <ActivityButton active={activeItem === 'assistant'} expanded={activePanel === 'assistant'} label="助手" onClick={() => selectTool('assistant')}>
        <AppearanceIcon kind="assistant"><MessageSquare size={18} aria-hidden="true" /></AppearanceIcon>
      </ActivityButton>
    </div>
    <div className="spacer" />
    <ActivityButton kind="page" active={focusedKind === 'settings'} label="设置" onClick={() => openPage('settings')} onContextMenu={() => onOpenRight('settings')}>
      <AppearanceIcon kind="settings"><Settings size={18} aria-hidden="true" /></AppearanceIcon>
    </ActivityButton>
  </nav>;
}
