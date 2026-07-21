import { ArrowLeftRight, ChevronDown, PanelRight, X } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { surfaceKey, type WorkspacePaneId, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';

const TAB_WIDTH = 176;
const MENU_WIDTH = 34;
const TAB_STEP = 180;

type WorkspaceTabsBarProps = {
  entries: Array<{ id: string; title: string }>;
  layout: WorkspaceSurfaceLayout;
  onAddToAssistantContext?: (surface: WorkspaceSurface) => void;
  onClose: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onCloseOthers: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onClosePane: (pane: WorkspacePaneId) => void;
  onMove: (surface: WorkspaceSurface, pane: WorkspacePaneId, targetIndex?: number) => void;
  onSelect: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onSwap: () => void;
};

export function WorkspaceTabsBar({
  entries,
  layout,
  onAddToAssistantContext,
  onClose,
  onCloseOthers,
  onClosePane,
  onMove,
  onSelect,
  onSwap
}: WorkspaceTabsBarProps) {
  const split = Boolean(layout.right);
  const [dropTarget, setDropTarget] = useState<{ index: number; pane: WorkspacePaneId } | null>(null);
  const [pointerDrag, setPointerDrag] = useState<{
    dragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    surface: WorkspaceSurface;
  } | null>(null);
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  const dragVisualRef = useRef<{
    grabX: number;
    grabY: number;
    rect: DOMRect;
  } | null>(null);
  const suppressNextTabClickRef = useRef(false);
  const dragActive = pointerDrag?.dragging === true;
  const draggingKey = pointerDrag?.dragging ? surfaceKey(pointerDrag.surface) : null;

  const startPointerDrag = (surface: WorkspaceSurface, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest('[data-tab-close="true"]')) {
      return;
    }
    setDropTarget(null);
    dragVisualRef.current = {
      grabX: event.clientX - event.currentTarget.getBoundingClientRect().left,
      grabY: event.clientY - event.currentTarget.getBoundingClientRect().top,
      rect: event.currentTarget.getBoundingClientRect(),
    };
    setPointerDrag({
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      surface
    });
  };

  const selectTab = (pane: WorkspacePaneId, surface: WorkspaceSurface) => {
    if (!suppressNextTabClickRef.current) {
      onSelect(pane, surface);
    }
  };

  useEffect(() => {
    if (!pointerDrag) {
      return undefined;
    }

    const updateDropTarget = (offsetX: number, offsetY: number) => {
      const visual = dragVisualRef.current;
      if (!visual) return null;
      const centerX = visual.rect.left + offsetX + visual.rect.width / 2;
      const centerY = visual.rect.top + offsetY + visual.rect.height / 2;
      const splitTarget = document.querySelector<HTMLElement>('[data-workspace-split-drop-target]');
      if (splitTarget) {
        const bounds = splitTarget.getBoundingClientRect();
        if (centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom) {
          return { index: 0, pane: 'right' as const };
        }
      }
      const target = [...document.querySelectorAll<HTMLElement>('[data-workspace-drop-pane]')]
        .reverse()
        .find((paneElement) => {
        const bounds = paneElement.getBoundingClientRect();
        return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
      });
      const pane = target?.dataset.workspaceDropPane as WorkspacePaneId | undefined;
      if (!target || (pane !== 'left' && pane !== 'right')) {
        return null;
      }
      const paneLeft = target.getBoundingClientRect().left;
      const slots = [...target.querySelectorAll<HTMLElement>('[data-workspace-tab-index]')]
        .map((tab) => ({
          center: paneLeft + tab.offsetLeft + tab.offsetWidth / 2,
          index: Number(tab.dataset.workspaceTabIndex ?? 0)
        }))
        .sort((left, right) => left.center - right.center);
      const nextSlot = slots.find((slot) => centerX < slot.center);
      const rawIndex = nextSlot?.index ?? Number(target.dataset.workspaceTabCount ?? 0);
      const sourceTabs = pane === 'left' ? layout.leftTabs : layout.rightTabs;
      const sourceIndex = sourceTabs.findIndex((surface) => surfaceKey(surface) === surfaceKey(pointerDrag.surface));
      const index = sourceIndex >= 0 && rawIndex > sourceIndex ? rawIndex - 1 : rawIndex;
      return { index, pane };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerDrag.pointerId) {
        return;
      }
      const dragging = pointerDrag.dragging || Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) >= 3;
      if (!dragging) {
        return;
      }
      event.preventDefault();
      setPointerDrag((current) => current && !current.dragging ? { ...current, dragging: true } : current);
      setDragCursor({ x: event.clientX, y: event.clientY });
      const offsetX = event.clientX - pointerDrag.startX;
      const offsetY = event.clientY - pointerDrag.startY;
      const target = updateDropTarget(offsetX, offsetY);
      if (target) {
        setDropTarget((current) =>
          current?.pane === target.pane && current.index === target.index ? current : target
        );
      } else {
        setDropTarget(null);
      }
    };

    const resetPointerDrag = () => {
      const visual = dragVisualRef.current;
      dragVisualRef.current = null;
      setDragCursor(null);
      setDropTarget(null);
      setPointerDrag(null);
    };

    const finishPointerDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerDrag.pointerId) {
        return;
      }
      if (pointerDrag.dragging) {
        const elementAtPointer = typeof document.elementFromPoint === 'function'
          ? document.elementFromPoint(event.clientX, event.clientY)
          : null;
        const assistantDropZone = elementAtPointer
          ?.closest<HTMLElement>('[data-assistant-context-dropzone="true"]');
        const target = updateDropTarget(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
        if (assistantDropZone && isAssistantContextSurface(pointerDrag.surface)) {
          onAddToAssistantContext?.(pointerDrag.surface);
        } else if (target) {
          onMove(pointerDrag.surface, target.pane, target.index);
        }
        suppressNextTabClickRef.current = true;
        window.setTimeout(() => { suppressNextTabClickRef.current = false; }, 0);
      }
      resetPointerDrag();
    };

    const cancelPointerDrag = (event?: Event) => {
      if (event instanceof PointerEvent && event.pointerId !== pointerDrag.pointerId) return;
      resetPointerDrag();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelPointerDrag();
    };

    window.addEventListener('pointermove', handlePointerMove, { capture: true });
    window.addEventListener('pointerup', finishPointerDrag, { capture: true });
    window.addEventListener('pointercancel', cancelPointerDrag, { capture: true });
    window.addEventListener('blur', cancelPointerDrag);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, { capture: true });
      window.removeEventListener('pointerup', finishPointerDrag, { capture: true });
      window.removeEventListener('pointercancel', cancelPointerDrag, { capture: true });
      window.removeEventListener('blur', cancelPointerDrag);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [layout.leftTabs, layout.rightTabs, onAddToAssistantContext, onMove, pointerDrag]);

  const sourcePane = draggingKey
    ? layout.leftTabs.some((surface) => surfaceKey(surface) === draggingKey) ? 'left' : 'right'
    : null;
  const sourceTabs = sourcePane === 'left' ? layout.leftTabs : sourcePane === 'right' ? layout.rightTabs : [];
  const sourceIndex = draggingKey ? sourceTabs.findIndex((surface) => surfaceKey(surface) === draggingKey) : -1;

  return (
    <div className={cn(
      'tabsbar workspace-tabsbar',
      split && 'is-split',
      dragActive && 'is-tab-dragging',
      dragActive && pointerDrag && isAssistantContextSurface(pointerDrag.surface) && 'is-assistant-context-dragging'
    )}>
      <div className={cn('workspace-tabsbar-panes', split && 'is-split')}>
        <TabPane
          active={layout.left}
          entries={entries}
          label="左侧标签"
          pane="left"
          tabs={layout.leftTabs}
          onClose={onClose}
          onCloseOthers={onCloseOthers}
          onClosePane={onClosePane}
          onMove={onMove}
          dropIndex={dropTarget?.pane === 'left' ? dropTarget.index : null}
          draggingKey={draggingKey}
          dragSource={{ index: sourceIndex, pane: sourcePane }}
          dragTarget={dropTarget}
          onPointerDragStart={startPointerDrag}
          onSelect={selectTab}
        />
        {split ? <div className="workspace-tabsbar-divider" aria-hidden="true" /> : null}
        {split && layout.right ? (
          <TabPane
            active={layout.right}
            entries={entries}
            label="右侧标签"
            pane="right"
            tabs={layout.rightTabs}
            onClose={onClose}
            onCloseOthers={onCloseOthers}
            onClosePane={onClosePane}
            onMove={onMove}
            dropIndex={dropTarget?.pane === 'right' ? dropTarget.index : null}
            draggingKey={draggingKey}
            dragSource={{ index: sourceIndex, pane: sourcePane }}
            dragTarget={dropTarget}
            onPointerDragStart={startPointerDrag}
            onSelect={selectTab}
          />
        ) : null}
      </div>
      {split ? (
        <div className="workspace-tabsbar-actions">
          <Button
            aria-label="交换左右分屏"
            size="icon-xs"
            title="交换左右分屏"
            type="button"
            variant="ghost"
            onClick={onSwap}
          >
            <ArrowLeftRight size={13} aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      {!split && dragActive ? (
        <div
          className={cn('workspace-tabsbar-split-drop-target', dropTarget?.pane === 'right' && 'is-drop-target')}
          data-workspace-split-drop-target="true"
        >
          <PanelRight size={14} aria-hidden="true" />
          <span>新建右侧分屏</span>
        </div>
      ) : null}
      {dragActive && pointerDrag && dragCursor && dragVisualRef.current && typeof document !== 'undefined'
        ? createPortal(
          <div aria-hidden="true" className="workspace-tab-drag-layer">
            <div
              className="workspace-tab-drag-preview"
              style={{
                left: dragCursor.x - dragVisualRef.current.grabX,
                top: dragCursor.y - dragVisualRef.current.grabY,
                width: dragVisualRef.current.rect.width
              }}
            >
              <span className="truncate">{surfaceLabel(pointerDrag.surface, entries)}</span>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  );
}

function TabPane({
  active,
  entries,
  label,
  pane,
  tabs,
  onClose,
  onCloseOthers,
  onClosePane,
  onMove,
  dropIndex,
  draggingKey,
  dragSource,
  dragTarget,
  onPointerDragStart,
  onSelect
}: {
  active: WorkspaceSurface;
  entries: Array<{ id: string; title: string }>;
  label: string;
  pane: WorkspacePaneId;
  tabs: WorkspaceSurface[];
  onClose: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onCloseOthers: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onClosePane: (pane: WorkspacePaneId) => void;
  onMove: (surface: WorkspaceSurface, pane: WorkspacePaneId, targetIndex?: number) => void;
  dropIndex: number | null;
  draggingKey: string | null;
  dragSource: { index: number; pane: WorkspacePaneId | null };
  dragTarget: { index: number; pane: WorkspacePaneId } | null;
  onPointerDragStart: (surface: WorkspaceSurface, event: ReactPointerEvent<HTMLDivElement>) => void;
  onSelect: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const width = useElementWidth(ref);
  const fullCapacity = Math.floor(width / TAB_WIDTH);
  const visibleCount = tabs.length <= fullCapacity
    ? tabs.length
    : Math.max(1, Math.floor((width - MENU_WIDTH) / TAB_WIDTH));
  const { hidden, visible } = useMemo(() => splitTabs(tabs, active, visibleCount), [active, tabs, visibleCount]);
  const activeKey = surfaceKey(active);

  return (
    <div
      className="workspace-tab-pane"
      data-workspace-pane={pane}
      data-workspace-drop-pane={pane}
      data-workspace-tab-count={tabs.length}
      ref={ref}
    >
      {visible.map((surface) => (
        (() => {
          const index = tabs.findIndex((tab) => surfaceKey(tab) === surfaceKey(surface));
          const transform = tabDragTransform({
            dragSource,
            index,
            pane,
            target: dragTarget
          });
          return (
        <ContextMenu key={surfaceKey(surface)}>
        <ContextMenuTrigger asChild>
        <div
          className={cn(
            'workspace-surface-tab',
            surfaceKey(surface) === activeKey && 'is-active',
            draggingKey === surfaceKey(surface) && 'is-dragging',
            dropIndex === index && 'is-drop-target'
          )}
          data-workspace-tab-index={index}
          style={transform ? { transform } : undefined}
          onPointerDown={(event) => onPointerDragStart(surface, event)}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(pane, surface);
            }
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => onSelect(pane, surface)}>
                <span className="truncate">{surfaceLabel(surface, entries)}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{surfaceLabel(surface, entries)}</TooltipContent>
          </Tooltip>
          <button
            aria-label={`关闭${surfaceLabel(surface, entries)}`}
            data-tab-close="true"
            type="button"
            onClick={() => onClose(pane, surface)}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={pane === 'left'} onSelect={() => onMove(surface, 'left')}>移到左侧</ContextMenuItem>
          <ContextMenuItem disabled={pane === 'right'} onSelect={() => onMove(surface, 'right')}>移到右侧分屏</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onClose(pane, surface)}>关闭</ContextMenuItem>
          <ContextMenuItem onSelect={() => onCloseOthers(pane, surface)}>关闭其他</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={pane === 'left'} onSelect={() => onClosePane('left')}>关闭左侧</ContextMenuItem>
          <ContextMenuItem disabled={pane === 'right'} onSelect={() => onClosePane('right')}>关闭右侧</ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>
          );
        })()
      ))}
      {hidden.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="workspace-tabs-overflow" title={`展开${label}`} type="button">
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {hidden.map((surface) => (
              <DropdownMenuItem key={surfaceKey(surface)} onSelect={() => onSelect(pane, surface)}>
                <span className="truncate">{surfaceLabel(surface, entries)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function isAssistantContextSurface(surface: WorkspaceSurface) {
  return surface.kind === 'entry-overview' ||
    surface.kind === 'pdf' ||
    surface.kind === 'reflow' ||
    surface.kind === 'note';
}

function tabDragTransform({
  dragSource,
  index,
  pane,
  target
}: {
  dragSource: { index: number; pane: WorkspacePaneId | null };
  index: number;
  pane: WorkspacePaneId;
  target: { index: number; pane: WorkspacePaneId } | null;
}) {
  if (!dragSource.pane) return null;
  if (pane === dragSource.pane && index === dragSource.index) {
    return null;
  }
  if (!target) return null;
  if (pane === dragSource.pane && pane === target.pane) {
    if (target.index > dragSource.index && index > dragSource.index && index <= target.index) return `translateX(-${TAB_STEP}px)`;
    if (target.index < dragSource.index && index >= target.index && index < dragSource.index) return `translateX(${TAB_STEP}px)`;
    return null;
  }
  if (pane === dragSource.pane && index > dragSource.index) return `translateX(-${TAB_STEP}px)`;
  if (pane === target.pane && index >= target.index) return `translateX(${TAB_STEP}px)`;
  return null;
}

function splitTabs(tabs: WorkspaceSurface[], active: WorkspaceSurface, visibleCount: number) {
  if (tabs.length <= visibleCount) return { hidden: [], visible: tabs };
  const visible = tabs.slice(0, visibleCount);
  if (!visible.some((tab) => surfaceKey(tab) === surfaceKey(active))) {
    visible[visible.length - 1] = active;
  }
  const visibleKeys = new Set(visible.map(surfaceKey));
  return { hidden: tabs.filter((tab) => !visibleKeys.has(surfaceKey(tab))), visible };
}

function useElementWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.round(element.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function surfaceLabel(surface: WorkspaceSurface, entries: Array<{ id: string; title: string }>) {
  const title = 'entryId' in surface ? entries.find((entry) => entry.id === surface.entryId)?.title ?? '条目' : '';
  switch (surface.kind) {
    case 'library': return '条目库';
    case 'settings': return '设置';
    case 'create-entry': return '新建条目';
    case 'mineru-client-guide': return 'MinerU 客户端教程';
    case 'tag-editor': return '标签管理';
    case 'entry-overview': return `${title} · 概览`;
    case 'pdf': return `${title} · PDF`;
    case 'reflow': return `${title} · 重排视图`;
    case 'note': return `${title} · 笔记`;
    case 'segment-notes': case 'annotations': return `${title} · 片段记录`;
    case 'source-links': return `${title} · 来源链接`;
    case 'entry-trash': return `${title} · 回收站`;
  }
}
