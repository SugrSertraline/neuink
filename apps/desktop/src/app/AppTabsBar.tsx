import {
  ChevronDown,
  Check,
  FilePlus2,
  FileText,
  FileType,
  PanelLeft,
  PanelRight,
  ScrollText,
  Settings,
  Tags,
  X
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { ContentPaneId } from './editorLayout';

type ContentTab = {
  contentId: string;
  entryId: string;
  entryTitle: string;
  kind: 'entry' | 'note' | 'pdf' | 'reflow';
  pane: ContentPaneId;
  tabId: string;
  title: string;
};

type TabMenuItem = {
  icon: ReactNode;
  label: string;
  value: string;
};

type ClosableTabMenuItem = TabMenuItem & {
  onClose: () => void;
};

const FIXED_TAB_WIDTH = 136;
const CONTENT_TAB_WIDTH = 176;
const OVERFLOW_BUTTON_WIDTH = 34;
const TAB_DRAG_THRESHOLD = 4;

type TabPointerDragState = {
  currentX: number;
  currentY: number;
  dragging: boolean;
  pointerId: number;
  startX: number;
  startY: number;
  tabId: string;
};

type TabDropTarget = {
  pane: ContentPaneId;
  targetIndex?: number;
};

type AppTabsBarProps = {
  activeTab: string;
  createTabOpen: boolean;
  leftContentTabIds: string[];
  openContentTabs: ContentTab[];
  rightContentTabIds: string[];
  settingsTabOpen: boolean;
  tagEditorTabOpen: boolean;
  onCloseCreateEntryTab: () => void;
  onCloseContentTab: (tabId: string) => void;
  onCloseSettingsTab: () => void;
  onCloseTagEditorTab: () => void;
  onDropContentTab: (tabId: string, pane: ContentPaneId, targetIndex?: number) => void;
  onDropContentTabToAssistant: (tabId: string) => void;
  onMoveContentTab: (tabId: string, pane: ContentPaneId) => void;
  onSelectTab: (tabId: string) => void;
};

export function AppTabsBar({
  activeTab,
  createTabOpen,
  leftContentTabIds,
  openContentTabs,
  rightContentTabIds,
  settingsTabOpen,
  tagEditorTabOpen,
  onCloseCreateEntryTab,
  onCloseContentTab,
  onCloseSettingsTab,
  onCloseTagEditorTab,
  onDropContentTab,
  onDropContentTabToAssistant,
  onMoveContentTab,
  onSelectTab
}: AppTabsBarProps) {
  const [pointerDrag, setPointerDrag] = useState<TabPointerDragState | null>(null);
  const [dropTarget, setDropTarget] = useState<TabDropTarget | null>(null);
  const suppressNextTabClickRef = useRef(false);
  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const leftPaneWidth = useElementWidth(leftPaneRef);
  const rightPaneWidth = useElementWidth(rightPaneRef);
  const tabById = new Map(openContentTabs.map((tab) => [tab.tabId, tab]));
  const leftTabs = leftContentTabIds
    .map((tabId) => tabById.get(tabId))
    .filter((tab): tab is ContentTab => Boolean(tab));
  const rightTabs = rightContentTabIds
    .map((tabId) => tabById.get(tabId))
    .filter((tab): tab is ContentTab => Boolean(tab));
  const splitTabs = rightTabs.length > 0;
  const libraryTab: TabMenuItem = {
    icon: <FileText size={14} aria-hidden="true" />,
    label: '条目库',
    value: 'library'
  };
  const utilityLeftTabs: ClosableTabMenuItem[] = [
    ...(createTabOpen
      ? [{
          icon: <FilePlus2 size={14} aria-hidden="true" />,
          label: '创建条目',
          onClose: onCloseCreateEntryTab,
          value: 'create-entry'
        }]
      : []),
    ...(tagEditorTabOpen
      ? [{
          icon: <Tags size={14} aria-hidden="true" />,
          label: '标签编辑',
          onClose: onCloseTagEditorTab,
          value: 'tag-editor'
        }]
      : []),
    ...(settingsTabOpen
      ? [{
          icon: <Settings size={14} aria-hidden="true" />,
          label: '设置',
          onClose: onCloseSettingsTab,
          value: 'settings'
        }]
      : [])
  ];
  const {
    hiddenContentTabs: hiddenLeftTabs,
    hiddenUtilityTabs,
    visibleContentTabs: visibleLeftTabs,
    visibleUtilityTabs
  } = splitLeftPaneTabs(
    leftPaneWidth,
    utilityLeftTabs,
    leftTabs,
    activeTab
  );
  const fixedLeftMenuTabs: TabMenuItem[] = [
    libraryTab,
    ...hiddenUtilityTabs.map(({ icon, label, value }) => ({ icon, label, value }))
  ];
  const rightVisibleCount = estimateVisibleContentTabCount(
    rightPaneWidth,
    0,
    rightTabs.length
  );
  const { hiddenTabs: hiddenRightTabs, visibleTabs: visibleRightTabs } = useMemo(
    () => splitVisibleTabs(rightTabs, activeTab, rightVisibleCount),
    [activeTab, rightTabs, rightVisibleCount]
  );
  const dragPreview =
    pointerDrag?.dragging && tabById.get(pointerDrag.tabId)
      ? {
          currentX: pointerDrag.currentX,
          currentY: pointerDrag.currentY,
          tab: tabById.get(pointerDrag.tabId) as ContentTab
        }
      : null;

  const beginTabPointerDrag = (tabId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDropTarget(null);
    setPointerDrag({
      currentX: event.clientX,
      currentY: event.clientY,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tabId
    });
  };

  useEffect(() => {
    if (!pointerDrag) {
      return undefined;
    }

    const updatePointerDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerDrag.pointerId) {
        return;
      }
      const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
      if (pointerDrag.dragging || distance >= TAB_DRAG_THRESHOLD) {
        event.preventDefault();
      }
      if (distance >= TAB_DRAG_THRESHOLD) {
        setDropTarget(findTabPointerDropTarget(event.clientX, event.clientY));
      }
      setPointerDrag((current) => {
        if (!current || current.pointerId !== event.pointerId) {
          return current;
        }
        const nextDistance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
        return {
          ...current,
          currentX: event.clientX,
          currentY: event.clientY,
          dragging: current.dragging || nextDistance >= TAB_DRAG_THRESHOLD
        };
      });
    };

    const finishPointerDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerDrag.pointerId) {
        return;
      }
      if (pointerDrag.dragging) {
        event.preventDefault();
        suppressNextTabClickRef.current = true;
        window.setTimeout(() => {
          suppressNextTabClickRef.current = false;
        }, 0);
        const assistantDropTarget = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-assistant-context-dropzone="true"]');
        const target = findTabPointerDropTarget(event.clientX, event.clientY);
        if (assistantDropTarget) {
          onDropContentTabToAssistant(pointerDrag.tabId);
        } else if (target) {
          onDropContentTab(pointerDrag.tabId, target.pane, target.targetIndex);
        }
      }
      setDropTarget(null);
      setPointerDrag(null);
    };

    const cancelPointerDrag = (event: PointerEvent) => {
      if (event.pointerId === pointerDrag.pointerId) {
        setDropTarget(null);
        setPointerDrag(null);
      }
    };

    window.addEventListener('pointermove', updatePointerDrag, { capture: true });
    window.addEventListener('pointerup', finishPointerDrag, { capture: true });
    window.addEventListener('pointercancel', cancelPointerDrag, { capture: true });
    return () => {
      window.removeEventListener('pointermove', updatePointerDrag, { capture: true });
      window.removeEventListener('pointerup', finishPointerDrag, { capture: true });
      window.removeEventListener('pointercancel', cancelPointerDrag, { capture: true });
    };
  }, [onDropContentTab, onDropContentTabToAssistant, pointerDrag]);

  return (
    <nav
      className={cn('tabsbar', pointerDrag?.dragging && 'is-tab-dragging')}
      onClickCapture={(event) => {
        const target = event.target;
        if (!suppressNextTabClickRef.current || !(target instanceof Element)) {
          return;
        }
        if (!target.closest('[data-content-tab="true"]')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        suppressNextTabClickRef.current = false;
      }}
    >
      <TabsList
        className={cn(
          'tabsbar-list h-8 bg-transparent p-0',
          splitTabs && 'is-split'
        )}
        data-editor-tabs="true"
        variant="line"
      >
        <TabDropZone
          className={cn(
            'tabsbar-pane-tabs',
            dropTarget?.pane === 'left' && 'is-drop-target'
          )}
          innerRef={leftPaneRef}
          pane="left"
          onDropContentTab={onDropContentTab}
        >
          <TabsTrigger className="tabsbar-fixed-tab h-8 justify-start px-3" value="library">
            <FileText size={14} aria-hidden="true" />
            条目库
          </TabsTrigger>
          {visibleUtilityTabs.map((tab) => (
            <CloseableTab
              active={activeTab === tab.value}
              icon={tab.icon}
              key={tab.value}
              label={tab.label}
              value={tab.value}
              onClose={tab.onClose}
            />
          ))}
          <ContentTabs
            allTabs={leftTabs}
            activeTab={activeTab}
            dropTarget={dropTarget}
            draggingTabId={pointerDrag?.dragging ? pointerDrag.tabId : null}
            pane="left"
            tabs={visibleLeftTabs}
            onCloseContentTab={onCloseContentTab}
            onMoveContentTab={onMoveContentTab}
            onTabPointerDown={beginTabPointerDrag}
          />
          <TabListMenu
            activeTab={activeTab}
            fixedTabs={fixedLeftMenuTabs}
            forceVisible={hiddenUtilityTabs.length > 0 || hiddenLeftTabs.length > 0}
            label="左侧标签"
            tabs={hiddenLeftTabs}
            onSelectTab={onSelectTab}
          />
        </TabDropZone>

        {splitTabs ? <div className="tabsbar-content-divider" aria-hidden="true" /> : null}

        {splitTabs ? (
          <TabDropZone
            className={cn(
              'tabsbar-pane-tabs',
              dropTarget?.pane === 'right' && 'is-drop-target'
            )}
            innerRef={rightPaneRef}
            pane="right"
            onDropContentTab={onDropContentTab}
          >
            <ContentTabs
              allTabs={rightTabs}
              activeTab={activeTab}
              dropTarget={dropTarget}
              draggingTabId={pointerDrag?.dragging ? pointerDrag.tabId : null}
              pane="right"
              tabs={visibleRightTabs}
              onCloseContentTab={onCloseContentTab}
              onMoveContentTab={onMoveContentTab}
              onTabPointerDown={beginTabPointerDrag}
            />
            <TabListMenu
              activeTab={activeTab}
              fixedTabs={[]}
              forceVisible={hiddenRightTabs.length > 0}
              label="右侧标签"
              tabs={hiddenRightTabs}
              onSelectTab={onSelectTab}
            />
          </TabDropZone>
        ) : null}
        {!splitTabs && pointerDrag?.dragging ? (
          <TabDropZone
            className={cn(
              'tabsbar-side-drop-target',
              dropTarget?.pane === 'right' && 'is-drop-target'
            )}
            pane="right"
            onDropContentTab={onDropContentTab}
          >
            <PanelRight size={14} aria-hidden="true" />
            <span>拖到右侧分屏</span>
          </TabDropZone>
        ) : null}
      </TabsList>
      {dragPreview
        ? createPortal(
            <div
              className="tabsbar-drag-preview"
              style={{
                left: dragPreview.currentX,
                top: dragPreview.currentY
              }}
            >
              {contentTabIcon(dragPreview.tab.kind)}
              <span>{`${dragPreview.tab.entryTitle} · ${dragPreview.tab.title}`}</span>
            </div>,
            document.body
          )
        : null}
    </nav>
  );
}

function TabDropZone({
  children,
  className,
  innerRef,
  pane
}: {
  children: ReactNode;
  className?: string;
  innerRef?: RefObject<HTMLDivElement>;
  pane: ContentPaneId;
  onDropContentTab?: (tabId: string, pane: ContentPaneId, targetIndex?: number) => void;
}) {
  return (
    <div
      className={className}
      data-tab-drop-pane={pane}
      ref={innerRef}
    >
      {children}
    </div>
  );
}

function ContentTabs({
  allTabs,
  activeTab,
  dropTarget,
  draggingTabId,
  pane,
  tabs,
  onCloseContentTab,
  onMoveContentTab,
  onTabPointerDown
}: {
  allTabs: ContentTab[];
  activeTab: string;
  dropTarget: TabDropTarget | null;
  draggingTabId: string | null;
  pane: ContentPaneId;
  tabs: ContentTab[];
  onCloseContentTab: (tabId: string) => void;
  onMoveContentTab: (tabId: string, pane: ContentPaneId) => void;
  onTabPointerDown: (tabId: string, event: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <>
      {tabs.map((tab, index) => {
        const tabIndex = allTabs.findIndex((candidate) => candidate.tabId === tab.tabId);
        return (
          <CloseableTab
            active={activeTab === tab.tabId}
            dragging={draggingTabId === tab.tabId}
            dropAfter={isTabDropAfter(dropTarget, pane, tabIndex, index === tabs.length - 1)}
            dropBefore={isTabDropBefore(dropTarget, pane, tabIndex)}
            icon={contentTabIcon(tab.kind)}
            key={tab.tabId}
            label={`${tab.entryTitle} · ${tab.title}`}
            pane={pane}
            tabIndex={tabIndex >= 0 ? tabIndex : index}
            value={tab.tabId}
            onClose={() => onCloseContentTab(tab.tabId)}
            onMoveContentTab={onMoveContentTab}
            onTabPointerDown={onTabPointerDown}
          />
        );
      })}
    </>
  );
}

function TabListMenu({
  activeTab,
  fixedTabs,
  forceVisible = false,
  label,
  tabs,
  onSelectTab
}: {
  activeTab: string;
  fixedTabs: TabMenuItem[];
  forceVisible?: boolean;
  label: string;
  tabs: ContentTab[];
  onSelectTab: (tabId: string) => void;
}) {
  const items = [
    ...fixedTabs,
    ...tabs.map((tab) => ({
      icon: contentTabIcon(tab.kind),
      label: `${tab.entryTitle} · ${tab.title}`,
      value: tab.tabId
    }))
  ];

  if (!forceVisible && items.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="tabsbar-overflow-button"
          title={`展开${label}`}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="tabsbar-menu w-72"
        data-tabsbar-menu="true"
        sideOffset={6}
      >
        <DropdownMenuLabel className="tabsbar-menu-label">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator className="tabsbar-menu-separator" />
        {items.map((item) => (
          <DropdownMenuItem
            className={cn('tabsbar-menu-item', activeTab === item.value && 'is-active')}
            key={item.value}
            onSelect={() => onSelectTab(item.value)}
          >
            {item.icon}
            <span>{item.label}</span>
            {activeTab === item.value ? <Check size={14} aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CloseableTab({
  active,
  dragging = false,
  dropAfter = false,
  dropBefore = false,
  icon,
  label,
  pane,
  tabIndex,
  value,
  onClose,
  onTabPointerDown,
  onMoveContentTab
}: {
  active: boolean;
  dragging?: boolean;
  dropAfter?: boolean;
  dropBefore?: boolean;
  icon: ReactNode;
  label: string;
  pane?: ContentPaneId;
  tabIndex?: number;
  value: string;
  onClose: () => void;
  onTabPointerDown?: (tabId: string, event: ReactPointerEvent<HTMLElement>) => void;
  onMoveContentTab?: (tabId: string, pane: ContentPaneId) => void;
}) {
  const closeWithMiddleButton = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const tab = (
    <div
      className={cn(
        'tabsbar-closeable-tab group/tab relative flex h-8 items-center overflow-hidden rounded-md border text-foreground/75 transition-colors',
        dragging && 'is-dragging opacity-45',
        dropAfter && 'is-drop-after',
        dropBefore && 'is-drop-before',
        active
          ? 'border-primary/35 bg-white text-primary shadow-sm'
          : 'border-border bg-white/70 hover:border-primary/25 hover:bg-white hover:text-foreground'
      )}
      data-allow-context-menu="true"
      data-content-tab={pane ? 'true' : undefined}
      data-tab-index={tabIndex ?? undefined}
      draggable={false}
      onMouseDown={closeWithMiddleButton}
      onPointerDown={(event) => {
        if (!pane) {
          return;
        }
        onTabPointerDown?.(value, event);
      }}
    >
      <TabsTrigger
        className="h-full min-w-0 flex-1 cursor-grab justify-start border-0 bg-transparent px-3 pr-9 text-inherit shadow-none hover:bg-transparent active:cursor-grabbing data-active:border-transparent data-active:bg-transparent data-active:text-inherit data-active:shadow-none"
        value={value}
      >
        {icon}
        <span className="truncate">{label}</span>
      </TabsTrigger>
      <Button
        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-black/5 hover:text-foreground group-hover/tab:text-foreground"
        size="icon-xs"
        title="关闭标签页"
        type="button"
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      >
        <X size={13} aria-hidden="true" />
      </Button>
    </div>
  );

  if (!pane || !onMoveContentTab) {
    return tab;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={pane === 'left'} onSelect={() => onMoveContentTab(value, 'left')}>
          <PanelLeft size={14} aria-hidden="true" />
          分屏到左侧
        </ContextMenuItem>
        <ContextMenuItem disabled={pane === 'right'} onSelect={() => onMoveContentTab(value, 'right')}>
          <PanelRight size={14} aria-hidden="true" />
          分屏到右侧
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function findTabPointerDropTarget(x: number, y: number): TabDropTarget | null {
  const element = document.elementFromPoint(x, y);
  if (!element) {
    return null;
  }
  const paneElement = element.closest('[data-tab-drop-pane]');
  const pane = paneElement?.getAttribute('data-tab-drop-pane');
  if (pane !== 'left' && pane !== 'right') {
    return null;
  }

  const tabElement = element.closest('[data-content-tab="true"]');
  if (!tabElement || !paneElement?.contains(tabElement)) {
    return { pane };
  }

  const tabIndex = Number(tabElement.getAttribute('data-tab-index'));
  if (!Number.isFinite(tabIndex)) {
    return { pane };
  }

  const bounds = tabElement.getBoundingClientRect();
  const insertAfter = x > bounds.left + bounds.width / 2;
  return {
    pane,
    targetIndex: tabIndex + (insertAfter ? 1 : 0)
  };
}

function isTabDropBefore(
  dropTarget: TabDropTarget | null,
  pane: ContentPaneId,
  tabIndex: number
) {
  return dropTarget?.pane === pane && dropTarget.targetIndex === tabIndex;
}

function isTabDropAfter(
  dropTarget: TabDropTarget | null,
  pane: ContentPaneId,
  tabIndex: number,
  isLastVisibleTab: boolean
) {
  return (
    dropTarget?.pane === pane &&
    (dropTarget.targetIndex === tabIndex + 1 ||
      (dropTarget.targetIndex === undefined && isLastVisibleTab))
  );
}

function useElementWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const updateWidth = () => setWidth(Math.round(element.getBoundingClientRect().width));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function splitLeftPaneTabs(
  paneWidth: number,
  utilityTabs: ClosableTabMenuItem[],
  contentTabs: ContentTab[],
  activeTab: string
) {
  const items = [
    ...utilityTabs.map((tab) => ({ kind: 'utility' as const, tab, value: tab.value })),
    ...contentTabs.map((tab) => ({ kind: 'content' as const, tab, value: tab.tabId }))
  ];
  const visibleCount = estimateVisibleLeftPaneItemCount(paneWidth, items.length);
  const { hiddenItems, visibleItems } = splitVisibleItems(items, activeTab, visibleCount);

  return {
    hiddenContentTabs: hiddenItems
      .filter((item): item is Extract<typeof item, { kind: 'content' }> => item.kind === 'content')
      .map((item) => item.tab),
    hiddenUtilityTabs: hiddenItems
      .filter((item): item is Extract<typeof item, { kind: 'utility' }> => item.kind === 'utility')
      .map((item) => item.tab),
    visibleContentTabs: visibleItems
      .filter((item): item is Extract<typeof item, { kind: 'content' }> => item.kind === 'content')
      .map((item) => item.tab),
    visibleUtilityTabs: visibleItems
      .filter((item): item is Extract<typeof item, { kind: 'utility' }> => item.kind === 'utility')
      .map((item) => item.tab)
  };
}

function estimateVisibleLeftPaneItemCount(paneWidth: number, itemCount: number) {
  if (itemCount <= 0) {
    return 0;
  }
  if (paneWidth <= 0) {
    return itemCount;
  }

  const availableWithoutMenu = paneWidth - FIXED_TAB_WIDTH;
  const fullCapacity = Math.max(0, Math.floor(availableWithoutMenu / CONTENT_TAB_WIDTH));
  if (itemCount <= fullCapacity) {
    return itemCount;
  }

  const availableWithMenu = availableWithoutMenu - OVERFLOW_BUTTON_WIDTH;
  return Math.max(0, Math.floor(availableWithMenu / CONTENT_TAB_WIDTH));
}

function estimateVisibleContentTabCount(
  paneWidth: number,
  fixedTabCount: number,
  tabCount: number
) {
  if (tabCount <= 0) {
    return 0;
  }
  if (paneWidth <= 0) {
    return tabCount;
  }

  const fixedWidth = fixedTabCount * FIXED_TAB_WIDTH;
  const availableWithoutMenu = paneWidth - fixedWidth;
  const fullCapacity = Math.max(1, Math.floor(availableWithoutMenu / CONTENT_TAB_WIDTH));
  if (tabCount <= fullCapacity) {
    return tabCount;
  }

  const availableWithMenu = availableWithoutMenu - OVERFLOW_BUTTON_WIDTH;
  return Math.max(1, Math.floor(availableWithMenu / CONTENT_TAB_WIDTH));
}

function splitVisibleItems<T extends { value: string }>(
  items: T[],
  activeTab: string,
  visibleCount: number
) {
  if (visibleCount >= items.length) {
    return { hiddenItems: [], visibleItems: items };
  }
  if (visibleCount <= 0) {
    return { hiddenItems: items, visibleItems: [] };
  }

  const nextVisibleItems = items.slice(0, visibleCount);
  const activeHiddenItem = items.find(
    (item) => item.value === activeTab && !nextVisibleItems.some((visible) => visible.value === item.value)
  );
  if (activeHiddenItem) {
    nextVisibleItems[nextVisibleItems.length - 1] = activeHiddenItem;
  }

  const visibleSet = new Set(nextVisibleItems.map((item) => item.value));
  return {
    hiddenItems: items.filter((item) => !visibleSet.has(item.value)),
    visibleItems: nextVisibleItems
  };
}

function splitVisibleTabs(tabs: ContentTab[], activeTab: string, visibleCount: number) {
  if (visibleCount >= tabs.length) {
    return { hiddenTabs: [], visibleTabs: tabs };
  }

  const nextVisibleTabs = tabs.slice(0, Math.max(visibleCount, 1));
  const activeHiddenTab = tabs.find(
    (tab) => tab.tabId === activeTab && !nextVisibleTabs.some((visible) => visible.tabId === tab.tabId)
  );
  if (activeHiddenTab) {
    nextVisibleTabs[nextVisibleTabs.length - 1] = activeHiddenTab;
  }

  const visibleSet = new Set(nextVisibleTabs.map((tab) => tab.tabId));
  return {
    hiddenTabs: tabs.filter((tab) => !visibleSet.has(tab.tabId)),
    visibleTabs: nextVisibleTabs
  };
}

function contentTabIcon(kind: ContentTab['kind']) {
  if (kind === 'pdf') {
    return <FileType size={14} aria-hidden="true" />;
  }
  if (kind === 'reflow') {
    return <ScrollText size={14} aria-hidden="true" />;
  }
  return <FileText size={14} aria-hidden="true" />;
}
