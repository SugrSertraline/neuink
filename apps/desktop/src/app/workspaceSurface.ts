import type { SettingsNavigationTarget } from '@/modules/settings/settingsCatalog';
import { resolveSourceLinkSurface } from './workspaceSourceNavigation';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { NoteTarget } from '@/shared/types/domain';
import { noteTargetKey } from '@/shared/lib/noteOwner';
import { MAX_BROWSER_OPEN_REQUESTS, planWorkspaceBrowserTab, type BrowserTabOpenAction } from './workspaceBrowserTabs';
export type WorkspacePaneId = 'left' | 'right';

export type WorkspaceSurface = { viewId?: string } & (
  | { kind: 'assistant-reply'; message: ConversationMessage }
  | { kind: 'browser'; id: string; url?: string; title?: string; navigationId?: string; loading?: boolean; openRequestIds?: string[] }
  | { kind: 'note-review'; proposalId: string; label: string; entryId: string; noteId?: string | null }
  | { kind: 'library' }
  | { kind: 'relations' }
  | { kind: 'settings'; target?: SettingsNavigationTarget }
  | { kind: 'create-entry' }
  | { kind: 'mineru-client-guide' }
  | { kind: 'tag-editor' }
  | { kind: 'tag-reading'; tagId: string; label?: string }
  | { kind: 'tag-details'; tagId: string; label?: string; view?: 'overview' | 'papers' | 'notes' }
  | { kind: 'owned-note'; target: NoteTarget; label?: string }
  | { kind: 'entry-overview'; entryId: string; contextTagId?: string }
  | { kind: 'pdf'; entryId: string; contextTagId?: string }
  | { kind: 'reflow'; entryId: string; contextTagId?: string }
  | { kind: 'note'; entryId: string; noteId: string }
  | { kind: 'segment-notes'; entryId: string; segmentUid?: string; mode?: 'note' | 'annotation' }
  | { kind: 'source-links'; entryId: string }
  | { kind: 'entry-trash'; entryId: string });

export type WorkspaceSurfaceLayout = {
  focusedPane: WorkspacePaneId;
  left: WorkspaceSurface;
  leftTabs: WorkspaceSurface[];
  right: WorkspaceSurface | null;
  rightTabs: WorkspaceSurface[];
  pinnedTabKeys?: string[];
};

export const initialWorkspaceSurfaceLayout: WorkspaceSurfaceLayout = {
  focusedPane: 'left',
  left: { kind: 'library' },
  leftTabs: [{ kind: 'library' }],
  right: null,
  rightTabs: [],
  pinnedTabKeys: []
};

export type WorkspaceSurfaceAction =
  | BrowserTabOpenAction
  | { type: 'duplicate'; key: string; pane: WorkspacePaneId; viewId: string }
  | { type: 'updateBrowser'; id: string; url: string; title: string; metadata?: { navigationId?: string; loading?: boolean } }
  | { type: 'reset' }
  | { type: 'focus'; pane: WorkspacePaneId }
  | { type: 'open'; pane?: WorkspacePaneId; surface: WorkspaceSurface }
  | { type: 'close'; pane: WorkspacePaneId; key: string }
  | { type: 'closeOthers'; pane: WorkspacePaneId; key: string }
  | { type: 'closePane'; pane: WorkspacePaneId }
  | { type: 'move'; key: string; pane: WorkspacePaneId; targetIndex?: number }
  | { type: 'setPinned'; key: string; pinned: boolean }
  | { type: 'switchEntryView'; pane: WorkspacePaneId; key: string; view: 'entry-overview' | 'pdf' | 'reflow' }
  | { type: 'removeEntry'; entryId: string }
  | { type: 'removeNote'; entryId: string; noteId: string }
  | { type: 'closeRight' }
  | { type: 'swap' };

export function workspaceSurfaceReducer(
  state: WorkspaceSurfaceLayout,
  action: WorkspaceSurfaceAction
): WorkspaceSurfaceLayout {
  switch (action.type) {
    case 'openBrowser': {
      const result = planWorkspaceBrowserTab(state, action);
      if (result.status !== 'open') return state;
      const remember = (surface: WorkspaceSurface): WorkspaceSurface => action.source &&
        surface.kind === 'browser' && surface.id === action.source.sourceId
        ? { ...surface, openRequestIds: [...(surface.openRequestIds ?? []), action.source.requestId].slice(-MAX_BROWSER_OPEN_REQUESTS) } : surface;
      const prepared = !action.source ? state : result.pane === 'left'
        ? { ...state, left: remember(state.left), leftTabs: state.leftTabs.map(remember) }
        : { ...state, right: state.right ? remember(state.right) : null, rightTabs: state.rightTabs.map(remember) };
      return workspaceSurfaceReducer(prepared, { type: 'open', pane: result.pane, surface: result.surface });
    }
    case 'duplicate': {
      const source = [...state.leftTabs, ...state.rightTabs].find(tab => surfaceKey(tab) === action.key);
      if (!source || !canDuplicateSurface(source) || !action.viewId) return state;
      return workspaceSurfaceReducer(state, { type: 'open', pane: action.pane, surface: { ...source, viewId: action.viewId } });
    }
    case 'updateBrowser': {
      const update = (surface: WorkspaceSurface): WorkspaceSurface => surface.kind === 'browser' && surface.id === action.id
        ? { ...surface, url: action.url, title: action.title,
          navigationId: action.metadata?.navigationId, loading: action.metadata?.loading } : surface;
      return { ...state, left: update(state.left), right: state.right ? update(state.right) : null,
        leftTabs: state.leftTabs.map(update), rightTabs: state.rightTabs.map(update) };
    }
    case 'reset':
      return initialWorkspaceSurfaceLayout;
    case 'focus':
      return action.pane === 'right' && !state.right ? state : { ...state, focusedPane: action.pane };
    case 'open': {
      const pane = action.pane ?? state.focusedPane;
      const otherPane = pane === 'left' ? 'right' : 'left';
      const otherTabs = otherPane === 'left' ? state.leftTabs : state.rightTabs;
      const existingInOtherPane = otherTabs.find(
        (tab) => surfaceKey(tab) === surfaceKey(action.surface)
      );
      if (existingInOtherPane) {
        const updatedTabs = otherTabs.map((tab) => surfaceKey(tab) === surfaceKey(action.surface) ? action.surface : tab);
        return otherPane === 'left'
          ? { ...state, focusedPane: 'left', left: action.surface, leftTabs: updatedTabs }
          : { ...state, focusedPane: 'right', right: action.surface, rightTabs: updatedTabs };
      }
      const tabs = pane === 'left' ? state.leftTabs : state.rightTabs;
      const nextTabs = tabs.some((tab) => surfaceKey(tab) === surfaceKey(action.surface))
        ? tabs.map((tab) => surfaceKey(tab) === surfaceKey(action.surface) ? action.surface : tab)
        : [...tabs, action.surface];
      if (pane === 'right') {
        return { ...state, focusedPane: 'right', right: action.surface, rightTabs: nextTabs };
      }
      return { ...state, focusedPane: 'left', left: action.surface, leftTabs: nextTabs };
    }
    case 'close': {
      // A confirmed batch can collapse a pane before its remaining targets close.
      // The view identity stays valid even when the original pane no longer does.
      const pane = findSurfacePane(state, action.key);
      if (!pane) return state;
      const sourceTabs = pane === 'left' ? state.leftTabs : state.rightTabs;
      const tabs = sourceTabs.filter(tab => surfaceKey(tab) !== action.key);
      return pane === 'left'
        ? withSurfaceTabs(state, tabs, state.rightTabs)
        : withSurfaceTabs(state, state.leftTabs, tabs);
    }
    case 'setPinned': {
      const pane = findSurfacePane(state, action.key);
      if (!pane || Boolean(state.pinnedTabKeys?.includes(action.key)) === action.pinned) return state;
      const tabs = pane === 'left' ? state.leftTabs : state.rightTabs;
      const surface = tabs.find((tab) => surfaceKey(tab) === action.key);
      if (!surface) return state;
      const pinnedTabKeys = action.pinned
        ? [...(state.pinnedTabKeys ?? []), action.key]
        : (state.pinnedTabKeys ?? []).filter((key) => key !== action.key);
      const without = tabs.filter((tab) => surfaceKey(tab) !== action.key);
      const pinnedCount = without.filter((tab) => pinnedTabKeys.includes(surfaceKey(tab))).length;
      const ordered = insertSurface(without, surface, pinnedCount);
      return pane === 'left'
        ? { ...state, leftTabs: ordered, pinnedTabKeys }
        : { ...state, rightTabs: ordered, pinnedTabKeys };
    }
    case 'switchEntryView': {
      const tabs = action.pane === 'left' ? state.leftTabs : state.rightTabs;
      const index = tabs.findIndex((tab) => surfaceKey(tab) === action.key);
      const source = tabs[index];
      if (!source || !isEntryReadingView(source)) return state;
      const next: WorkspaceSurface = { kind: action.view, entryId: source.entryId, viewId: source.viewId,
        ...(source.contextTagId ? { contextTagId: source.contextTagId } : {}) };
      const nextKey = surfaceKey(next);
      if (nextKey === action.key) return state;
      const existingPane = findSurfacePane(state, nextKey);
      if (existingPane) {
        const existing = (existingPane === 'left' ? state.leftTabs : state.rightTabs).find((tab) => surfaceKey(tab) === nextKey);
        return existing ? workspaceSurfaceReducer(state, { type: 'open', pane: existingPane, surface: existing }) : state;
      }
      const nextTabs = [...tabs];
      nextTabs[index] = next;
      const pinnedTabKeys = state.pinnedTabKeys?.includes(action.key)
        ? [...(state.pinnedTabKeys ?? []).filter((key) => key !== action.key), nextKey]
        : state.pinnedTabKeys;
      return action.pane === 'left'
        ? { ...state, focusedPane: 'left', left: next, leftTabs: nextTabs, pinnedTabKeys }
        : { ...state, focusedPane: 'right', right: next, rightTabs: nextTabs, pinnedTabKeys };
    }
    case 'move': {
      const sourcePane = findSurfacePane(state, action.key);
      if (!sourcePane) {
        return state;
      }

      const sourceTabs = sourcePane === 'left' ? state.leftTabs : state.rightTabs;
      const surface = sourceTabs.find((tab) => surfaceKey(tab) === action.key);
      if (!surface) {
        return state;
      }

      if (sourcePane === action.pane) {
        const tabsWithoutSurface = sourceTabs.filter((tab) => surfaceKey(tab) !== action.key);
        const targetIndex = pinnedMoveIndex(state, action.key, tabsWithoutSurface, action.targetIndex);
        const reorderedTabs = insertSurface(tabsWithoutSurface, surface, targetIndex);
        return sourcePane === 'left'
          ? { ...state, leftTabs: reorderedTabs }
          : { ...state, rightTabs: reorderedTabs };
      }

      const destinationTabs = action.pane === 'left' ? state.leftTabs : state.rightTabs;
      const nextSourceTabs = sourceTabs.filter((tab) => surfaceKey(tab) !== action.key);
      const nextDestinationTabs = destinationTabs.filter((tab) => surfaceKey(tab) !== action.key);
      const targetIndex = pinnedMoveIndex(state, action.key, nextDestinationTabs, action.targetIndex);
      const orderedDestinationTabs = insertSurface(nextDestinationTabs, surface, targetIndex);

      if (sourcePane === 'left') {
        return withSurfaceTabs({ ...state, focusedPane: 'right', right: surface }, nextSourceTabs, orderedDestinationTabs);
      }
      return withSurfaceTabs({ ...state, focusedPane: 'left', left: surface }, orderedDestinationTabs, nextSourceTabs);
    }
    case 'removeEntry': {
      const isOtherEntry = (surface: WorkspaceSurface) =>
        !('entryId' in surface) || surface.entryId !== action.entryId;
      return withSurfaceTabs(state, state.leftTabs.filter(isOtherEntry), state.rightTabs.filter(isOtherEntry));
    }
    case 'closeOthers': {
      const tabs = action.pane === 'left' ? state.leftTabs : state.rightTabs;
      const surface = tabs.find((tab) => surfaceKey(tab) === action.key);
      if (!surface) return state;
      const retained = tabs.filter((tab) => surfaceKey(tab) === action.key || tab.kind === 'library' || state.pinnedTabKeys?.includes(surfaceKey(tab)));
      return action.pane === 'left'
        ? { ...state, focusedPane: 'left', left: surface, leftTabs: retained, pinnedTabKeys: retainPinnedKeys(state, retained, state.rightTabs) }
        : { ...state, focusedPane: 'right', right: surface, rightTabs: retained, pinnedTabKeys: retainPinnedKeys(state, state.leftTabs, retained) };
    }
    case 'closePane':
      return action.pane === 'right'
        ? withSurfaceTabs(state, state.leftTabs, [])
        : withSurfaceTabs({ ...state, focusedPane: 'left' }, [], state.rightTabs);
    case 'removeNote': {
      const isDeletedNote = (surface: WorkspaceSurface) =>
        surface.kind === 'note' && surface.entryId === action.entryId && surface.noteId === action.noteId;
      return withSurfaceTabs(state, state.leftTabs.filter(surface => !isDeletedNote(surface)),
        state.rightTabs.filter(surface => !isDeletedNote(surface)));
    }
    case 'closeRight':
      return withSurfaceTabs(state, state.leftTabs, []);
    case 'swap':
      return state.right
        ? {
            focusedPane: state.focusedPane === 'left' ? 'right' : 'left',
            left: state.right,
            leftTabs: state.rightTabs,
            right: state.left,
            rightTabs: state.leftTabs,
            pinnedTabKeys: state.pinnedTabKeys
          }
        : state;
  }
}

/** Empty panes must not manufacture a second singleton library tab after a swap.
 * Reuse the surviving pane and its view identities instead of remounting its contents. */
function withSurfaceTabs(state: WorkspaceSurfaceLayout, leftTabs: WorkspaceSurface[], rightTabs: WorkspaceSurface[]): WorkspaceSurfaceLayout {
  const activeTab = (tabs: WorkspaceSurface[], active: WorkspaceSurface | null) =>
    (active ? tabs.find(tab => surfaceKey(tab) === surfaceKey(active)) : undefined) ?? tabs[tabs.length - 1];
  if (!leftTabs.length && rightTabs.some(tab => tab.kind === 'library')) {
    return { ...state, focusedPane: 'left', left: activeTab(rightTabs, state.right), leftTabs: rightTabs,
      right: null, rightTabs: [], pinnedTabKeys: retainPinnedKeys(state, rightTabs, []) };
  }
  const remainingLeft: WorkspaceSurface[] = leftTabs.length ? leftTabs : [{ kind: 'library' }];
  return { ...state, left: activeTab(remainingLeft, state.left), leftTabs: remainingLeft,
    right: rightTabs.length ? activeTab(rightTabs, state.right) : null, rightTabs,
    focusedPane: rightTabs.length ? state.focusedPane : 'left',
    pinnedTabKeys: retainPinnedKeys(state, remainingLeft, rightTabs) };
}

/** Reveal cited evidence without replacing or moving the note that requested it. */
export function sourceLinkSurfaceActions(state: WorkspaceSurfaceLayout, entryId: string, originPane = state.focusedPane): WorkspaceSurfaceAction[] {
  const target = resolveSourceLinkSurface(state, entryId, originPane);
  return [
    ...workspaceSurfaceOpenActions(state, target.surface, target.pane),
    { type: 'focus', pane: originPane }
  ];
}

export function workspaceSurfaceOpenActions(
  state: WorkspaceSurfaceLayout,
  surface: WorkspaceSurface,
  pane?: WorkspacePaneId
): WorkspaceSurfaceAction[] {
  const key = surfaceKey(surface);
  const existingPane = findSurfacePane(state, key);
  if (pane && existingPane && existingPane !== pane) {
    return [
      { type: 'open', pane: existingPane, surface },
      { type: 'move', key, pane }
    ];
  }
  return [{ type: 'open', pane, surface }];
}

export function findSurfacePane(state: WorkspaceSurfaceLayout, key: string): WorkspacePaneId | null {
  if (state.leftTabs.some((surface) => surfaceKey(surface) === key)) {
    return 'left';
  }
  return state.rightTabs.some((surface) => surfaceKey(surface) === key) ? 'right' : null;
}

function clampTabIndex(index: number | undefined, length: number) {
  return Math.min(length, Math.max(0, index ?? length));
}

function pinnedMoveIndex(state: WorkspaceSurfaceLayout, key: string, tabs: WorkspaceSurface[], index: number | undefined) {
  const pinnedCount = tabs.filter((tab) => state.pinnedTabKeys?.includes(surfaceKey(tab))).length;
  const target = clampTabIndex(index, tabs.length);
  return state.pinnedTabKeys?.includes(key)
    ? Math.min(target, pinnedCount)
    : Math.max(target, pinnedCount);
}

function retainPinnedKeys(state: WorkspaceSurfaceLayout, left: WorkspaceSurface[], right: WorkspaceSurface[]) {
  const openKeys = new Set([...left, ...right].map(surfaceKey));
  return (state.pinnedTabKeys ?? []).filter((key) => openKeys.has(key));
}

export function isEntryReadingView(surface: WorkspaceSurface): surface is Extract<WorkspaceSurface, { kind: 'entry-overview' | 'pdf' | 'reflow' }> {
  return surface.kind === 'entry-overview' || surface.kind === 'pdf' || surface.kind === 'reflow';
}

function insertSurface(tabs: WorkspaceSurface[], surface: WorkspaceSurface, index: number) {
  return [...tabs.slice(0, index), surface, ...tabs.slice(index)];
}

export function surfaceKey(surface: WorkspaceSurface) {
  return surface.viewId ? `${surfaceContentKey(surface)}:view:${surface.viewId}` : surfaceContentKey(surface);
}
export function canDuplicateSurface(surface: WorkspaceSurface) {
  return ['pdf', 'reflow', 'note', 'owned-note', 'segment-notes'].includes(surface.kind);
}
export function surfaceContentKey(surface: WorkspaceSurface) {
  switch (surface.kind) {
    case 'browser': return `browser:${surface.id}`;
    case 'assistant-reply': return `assistant-reply:${surface.message.message_id}`;
    case 'note-review': return `note-review:${surface.proposalId}`;
    case 'tag-reading': return `tag-reading:${surface.tagId}`;
    case 'tag-details': return `tag-details:${surface.tagId}`;
    case 'owned-note': return `note:${noteTargetKey(surface.target)}`;
    case 'note': return `note:${surface.entryId}:${surface.noteId}`;
    case 'segment-notes': return `segment-records:${surface.entryId}`;
    case 'library': case 'relations': case 'settings': case 'create-entry': case 'mineru-client-guide': case 'tag-editor': return surface.kind;
    default: return `${surface.kind}:${surface.entryId}`;
  }
}

export function defaultEntryContentId(entry: Pick<LibraryEntry, 'pdfFileName'>, openPdfByDefault = true) {
  return openPdfByDefault && entry.pdfFileName ? 'pdf' : 'overview';
}

export function entryContentSurface(entryId: string, contentId: string, contextTagId?: string): WorkspaceSurface {
  const context = contextTagId ? { contextTagId } : {};
  if (contentId === 'pdf') return { kind: 'pdf', entryId, ...context };
  if (contentId === 'reflow') return { kind: 'reflow', entryId, ...context };
  if (contentId === 'overview') return { kind: 'entry-overview', entryId, ...context };
  if (contentId === 'segment-notes') return { kind: 'segment-notes', entryId };
  if (contentId === 'source-links') return { kind: 'source-links', entryId };
  if (contentId === 'entry-trash') return { kind: 'entry-trash', entryId };
  if (contentId.startsWith('note:')) return { kind: 'note', entryId, noteId: contentId.slice(5) };
  return { kind: 'entry-overview', entryId };
}

export function entryContentId(surface: WorkspaceSurface) {
  switch (surface.kind) {
    case 'note-review': return surface.noteId ? `note:${surface.noteId}` : null;
    case 'pdf': return 'pdf';
    case 'reflow': return 'reflow';
    case 'entry-overview': return 'overview';
    case 'segment-notes': return 'segment-notes';
    case 'source-links': return 'source-links';
    case 'entry-trash': return 'entry-trash';
    case 'note': return `note:${surface.noteId}`;
    default: return null;
  }
}

export function workspaceSurfaceLabel(
  surface: WorkspaceSurface,
  entries: Array<{ id: string; title: string }>
) {
  const title = 'entryId' in surface
    ? entries.find((entry) => entry.id === surface.entryId)?.title ?? '条目'
    : '';
  switch (surface.kind) {
    case 'library': return '条目库';
    case 'browser': return surface.title || '新网页';
    case 'assistant-reply': return '完整回复';
    case 'note-review': return `${surface.label} · 修改审阅`;
    case 'relations': return '关系图';
    case 'settings': return '设置';
    case 'create-entry': return '新建条目';
    case 'mineru-client-guide': return 'MinerU 客户端教程';
    case 'tag-editor': return '标签管理';
    case 'tag-reading': return `${surface.label ?? '标签'} · 平行阅读`;
    case 'tag-details': return `${surface.label ?? '标签'} · 详情`;
    case 'owned-note': return surface.label ?? '标签笔记';
    case 'entry-overview': return `${title} · 概览`;
    case 'pdf': return `${title} · PDF`;
    case 'reflow': return `${title} · 重排视图`;
    case 'note': return `${title} · 笔记`;
    case 'segment-notes': return `${title} · 片段记录`;
    case 'source-links': return `${title} · 引用此文`;
    case 'entry-trash': return `${title} · 回收站`;
  }
}

// Normalize old entry tabs at the boundary; storage and new navigation use real owners.
export function surfaceNoteTarget(surface: WorkspaceSurface): NoteTarget | null {
  return surface.kind === 'owned-note' ? surface.target : surface.kind === 'note'
    ? { owner: { kind: 'entry', entry_id: surface.entryId }, note_id: surface.noteId } : null;
}
export function noteSurface(target: NoteTarget, label?: string): WorkspaceSurface {
  return target.owner.kind === 'entry'
    ? { kind: 'note', entryId: target.owner.entry_id, noteId: target.note_id }
    : { kind: 'owned-note', target, label };
}
