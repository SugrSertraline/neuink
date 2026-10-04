import { ArrowLeftRight, ChevronDown, Link2, PanelRight, Pin, Plus, X } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
import {
  surfaceKey,
  isEntryReadingView,
  canDuplicateSurface,
  workspaceSurfaceLabel,
  type WorkspacePaneId,
  type WorkspaceSurface,
  type WorkspaceSurfaceLayout
} from './workspaceSurface';
import {
  resolveWorkspaceSurfacePair,
  workspaceSurfacePairRelationLabel
} from './workspaceSurfacePairing';
import { EntryTabHoverSwitch, entryTabViews } from './EntryTabHoverSwitch';

const TAB_WIDTH = 176;
const MENU_WIDTH = 34;
const TAB_STEP = 180;

type WorkspaceTabsBarProps = {
  onNewBrowser?: () => void;
  entries: Array<{ id: string; title: string; pdfFileName?: string | null }>;
  layout: WorkspaceSurfaceLayout;
  onAddToAssistantContext?: (surface: WorkspaceSurface) => void;
  onClose: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onCloseOthers: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onCloseToRight?: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onClosePane: (pane: WorkspacePaneId) => void;
  onDuplicate?: (surface: WorkspaceSurface, pane: WorkspacePaneId) => void;
  onMove: (surface: WorkspaceSurface, pane: WorkspacePaneId, targetIndex?: number) => void;
  onSetPinned?: (surface: WorkspaceSurface, pinned: boolean) => void;
  onSwitchEntryView?: (pane: WorkspacePaneId, surface: WorkspaceSurface, view: 'entry-overview' | 'pdf' | 'reflow') => void;
  onSelect: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onSwap: () => void;
};

export function WorkspaceTabsBar({
  onNewBrowser,
  entries,
  layout,
  onAddToAssistantContext,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onClosePane,
  onMove,
  onDuplicate,
  onSetPinned,
  onSwitchEntryView,
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
  const captureRef = useRef<{ element: HTMLElement; id: number } | null>(null);
  const releaseCapture = () => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture?.element.hasPointerCapture?.(capture.id)) capture.element.releasePointerCapture(capture.id);
  };
  useEffect(() => () => releaseCapture(), []);
  const dragActive = pointerDrag?.dragging === true;
  const draggingKey = pointerDrag?.dragging ? surfaceKey(pointerDrag.surface) : null;
  const pairRelationLabel = layout.right
    ? workspaceSurfacePairRelationLabel(
        resolveWorkspaceSurfacePair(layout.left, layout.right).relation
      )
    : null;

  const startPointerDrag = (surface: WorkspaceSurface, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || event.target instanceof Element && event.target.closest('[data-tab-close="true"]')) {
      return;
    }
    setDropTarget(null);
    captureRef.current = { element: event.currentTarget, id: event.pointerId };
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
      const paneBounds = target.getBoundingClientRect();
      const paneScale = target.offsetWidth > 0 ? paneBounds.width / target.offsetWidth : 1;
      const slots = [...target.querySelectorAll<HTMLElement>('[data-workspace-tab-index]')]
        .map((tab) => ({
          // TabPane is the offset parent. Use its untransformed layout slots,
          // converted to viewport pixels, so split offsets and UI zoom count once.
          center: paneBounds.left + (tab.offsetLeft + tab.offsetWidth / 2) * paneScale,
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
      const dragging = pointerDrag.dragging || Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) >= 4;
      if (!dragging) {
        return;
      }
      event.preventDefault();
      if (!pointerDrag.dragging) captureRef.current?.element.setPointerCapture?.(event.pointerId);
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
      releaseCapture();
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
    window.addEventListener('lostpointercapture', cancelPointerDrag, { capture: true });
    window.addEventListener('blur', cancelPointerDrag);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, { capture: true });
      window.removeEventListener('pointerup', finishPointerDrag, { capture: true });
      window.removeEventListener('pointercancel', cancelPointerDrag, { capture: true });
      window.removeEventListener('lostpointercapture', cancelPointerDrag, { capture: true });
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
    <div data-guide="tabs" className={cn(
      'tabsbar workspace-tabsbar',
      split && 'is-split',
      pairRelationLabel && 'has-pair-status',
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
          pinnedTabKeys={layout.pinnedTabKeys ?? []}
          onClose={onClose}
          onCloseOthers={onCloseOthers}
          onCloseToRight={onCloseToRight}
          onClosePane={onClosePane}
          onMove={onMove} onDuplicate={onDuplicate}
          onSetPinned={onSetPinned}
          onSwitchEntryView={onSwitchEntryView}
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
            pinnedTabKeys={layout.pinnedTabKeys ?? []}
            onClose={onClose}
            onCloseOthers={onCloseOthers}
            onCloseToRight={onCloseToRight}
            onClosePane={onClosePane}
            onMove={onMove} onDuplicate={onDuplicate}
            onSetPinned={onSetPinned}
            onSwitchEntryView={onSwitchEntryView}
            dropIndex={dropTarget?.pane === 'right' ? dropTarget.index : null}
            draggingKey={draggingKey}
            dragSource={{ index: sourceIndex, pane: sourcePane }}
            dragTarget={dropTarget}
            onPointerDragStart={startPointerDrag}
            onSelect={selectTab}
          />
        ) : null}
      </div>
      {split || onNewBrowser ? (
        <div className="workspace-tabsbar-actions">
          {onNewBrowser ? <Button aria-label="新建网页标签" title="新建网页标签" size="icon-sm" variant="ghost" type="button" onClick={onNewBrowser}><Plus size={16} /></Button> : null}
          {pairRelationLabel ? (
            <span
              aria-label={pairRelationLabel}
              className="workspace-tabsbar-pair-status"
              role="status"
              title={pairRelationLabel}
            >
              <Link2 size={12} aria-hidden="true" />
              联动
            </span>
          ) : null}
          {split ? <Button
            aria-label="交换左右分屏"
            size="icon-xs"
            title="交换左右分屏"
            type="button"
            variant="ghost"
            onClick={onSwap}
          >
            <ArrowLeftRight size={13} aria-hidden="true" />
          </Button> : null}
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
              <span className="truncate">{workspaceSurfaceLabel(pointerDrag.surface, entries)}</span>
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
  pinnedTabKeys,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onClosePane,
  onMove,
  onDuplicate,
  onSetPinned,
  onSwitchEntryView,
  dropIndex,
  draggingKey,
  dragSource,
  dragTarget,
  onPointerDragStart,
  onSelect
}: {
  active: WorkspaceSurface;
  entries: Array<{ id: string; title: string; pdfFileName?: string | null }>;
  label: string;
  pane: WorkspacePaneId;
  tabs: WorkspaceSurface[];
  pinnedTabKeys: string[];
  onClose: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onCloseOthers: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onCloseToRight?: (pane: WorkspacePaneId, surface: WorkspaceSurface) => void;
  onClosePane: (pane: WorkspacePaneId) => void;
  onDuplicate?: (surface: WorkspaceSurface, pane: WorkspacePaneId) => void;
  onMove: (surface: WorkspaceSurface, pane: WorkspacePaneId, targetIndex?: number) => void;
  onSetPinned?: (surface: WorkspaceSurface, pinned: boolean) => void;
  onSwitchEntryView?: (pane: WorkspacePaneId, surface: WorkspaceSurface, view: 'entry-overview' | 'pdf' | 'reflow') => void;
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
          const canClose = surface.kind !== 'library';
          const pinned = pinnedTabKeys.includes(surfaceKey(surface));
          const entry = isEntryReadingView(surface) ? entries.find((item) => item.id === surface.entryId) : undefined;
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
            pinned && 'is-pinned',
            draggingKey === surfaceKey(surface) && 'is-dragging',
            dropIndex === index && 'is-drop-target'
          )}
          data-allow-context-menu="true"
          data-workspace-tab-index={index}
          data-workspace-surface-key={surfaceKey(surface)}
          data-workspace-surface-active={surfaceKey(surface) === activeKey}
          style={transform ? { transform } : undefined}
          onPointerDown={(event) => onPointerDragStart(surface, event)}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              if (canClose) onClose(pane, surface);
            }
          }}
        >
          {isEntryReadingView(surface) && onSwitchEntryView ? (
            <EntryTabHoverSwitch
              dragging={draggingKey !== null}
              entry={entry}
              pinned={pinned}
              surface={surface}
              onSelect={() => onSelect(pane, surface)}
              onSwitch={(view) => onSwitchEntryView(pane, surface, view)}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => onSelect(pane, surface)}>
                  {pinned ? <Pin size={12} aria-hidden="true" className="workspace-tab-pin" /> : null}
                  <span className="truncate">{workspaceSurfaceLabel(surface, entries)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>{workspaceSurfaceLabel(surface, entries)}</TooltipContent>
            </Tooltip>
          )}
          {canClose && !pinned ? <button
            aria-label={`关闭${workspaceSurfaceLabel(surface, entries)}`}
            data-tab-close="true"
            type="button"
            onClick={() => onClose(pane, surface)}
          >
            <X size={13} aria-hidden="true" />
          </button> : null}
        </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isEntryReadingView(surface) && onSwitchEntryView ? <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>切换条目视图</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {entryTabViews.map(({ kind, label }) => <ContextMenuItem
                  key={kind}
                  disabled={surface.kind === kind || (kind !== 'entry-overview' && !entry?.pdfFileName)}
                  onSelect={() => onSwitchEntryView(pane, surface, kind)}
                >{label}</ContextMenuItem>)}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </> : null}
          {onDuplicate && canDuplicateSurface(surface) ? <ContextMenuItem data-guide="duplicate-reading-tab" onSelect={() => onDuplicate(surface, pane === 'left' ? 'right' : 'left')}>复制到另一分栏</ContextMenuItem> : null}
          {onSetPinned ? <ContextMenuItem onSelect={() => onSetPinned(surface, !pinned)}>{pinned ? '取消固定' : '固定在标签栏左侧'}</ContextMenuItem> : null}
          <ContextMenuItem disabled={pane === 'left'} onSelect={() => onMove(surface, 'left')}>移到左侧分栏</ContextMenuItem>
          <ContextMenuItem disabled={pane === 'right'} onSelect={() => onMove(surface, 'right')}>移到右侧分屏</ContextMenuItem>
          <ContextMenuSeparator />
          {canClose ? <ContextMenuItem onSelect={() => onClose(pane, surface)}>关闭</ContextMenuItem> : null}
          <ContextMenuItem onSelect={() => onCloseOthers(pane, surface)}>关闭其他</ContextMenuItem>
          {onCloseToRight ? <ContextMenuItem
            disabled={!tabs.slice(index + 1).some((tab) => tab.kind !== 'library' && !pinnedTabKeys.includes(surfaceKey(tab)))}
            onSelect={() => onCloseToRight(pane, surface)}
          >关闭右侧标签</ContextMenuItem> : null}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onClosePane(pane)}>关闭当前分栏</ContextMenuItem>
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
                <span className="truncate">{workspaceSurfaceLabel(surface, entries)}</span>
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
