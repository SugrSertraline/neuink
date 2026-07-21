export type WorkspacePaneId = 'left' | 'right';

export type WorkspaceSurface =
  | { kind: 'library' }
  | { kind: 'settings' }
  | { kind: 'create-entry' }
  | { kind: 'mineru-client-guide' }
  | { kind: 'tag-editor' }
  | { kind: 'entry-overview'; entryId: string }
  | { kind: 'pdf'; entryId: string }
  | { kind: 'reflow'; entryId: string }
  | { kind: 'note'; entryId: string; noteId: string }
  | { kind: 'segment-notes'; entryId: string; segmentUid?: string; mode?: 'note' | 'annotation' }
  | { kind: 'annotations'; entryId: string; segmentUid?: string }
  | { kind: 'source-links'; entryId: string }
  | { kind: 'entry-trash'; entryId: string };

export type WorkspaceSurfaceLayout = {
  focusedPane: WorkspacePaneId;
  left: WorkspaceSurface;
  leftTabs: WorkspaceSurface[];
  right: WorkspaceSurface | null;
  rightTabs: WorkspaceSurface[];
};

export const initialWorkspaceSurfaceLayout: WorkspaceSurfaceLayout = {
  focusedPane: 'left',
  left: { kind: 'library' },
  leftTabs: [{ kind: 'library' }],
  right: null,
  rightTabs: []
};

export type WorkspaceSurfaceAction =
  | { type: 'reset' }
  | { type: 'focus'; pane: WorkspacePaneId }
  | { type: 'open'; pane?: WorkspacePaneId; surface: WorkspaceSurface }
  | { type: 'close'; pane: WorkspacePaneId; key: string }
  | { type: 'closeOthers'; pane: WorkspacePaneId; key: string }
  | { type: 'closePane'; pane: WorkspacePaneId }
  | { type: 'move'; key: string; pane: WorkspacePaneId; targetIndex?: number }
  | { type: 'removeEntry'; entryId: string }
  | { type: 'removeNote'; entryId: string; noteId: string }
  | { type: 'closeRight' }
  | { type: 'swap' };

export function workspaceSurfaceReducer(
  state: WorkspaceSurfaceLayout,
  action: WorkspaceSurfaceAction
): WorkspaceSurfaceLayout {
  switch (action.type) {
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
        return otherPane === 'left'
          ? { ...state, focusedPane: 'left', left: existingInOtherPane }
          : { ...state, focusedPane: 'right', right: existingInOtherPane };
      }
      const tabs = pane === 'left' ? state.leftTabs : state.rightTabs;
      const nextTabs = tabs.some((tab) => surfaceKey(tab) === surfaceKey(action.surface))
        ? tabs
        : [...tabs, action.surface];
      if (pane === 'right') {
        return { ...state, focusedPane: 'right', right: action.surface, rightTabs: nextTabs };
      }
      return { ...state, focusedPane: 'left', left: action.surface, leftTabs: nextTabs };
    }
    case 'close': {
      const tabs = (action.pane === 'left' ? state.leftTabs : state.rightTabs)
        .filter((tab) => surfaceKey(tab) !== action.key);
      if (action.pane === 'right') {
        if (tabs.length === 0) {
          return { ...state, focusedPane: 'left', right: null, rightTabs: [] };
        }
        const nextActive = state.right && surfaceKey(state.right) !== action.key ? state.right : tabs[tabs.length - 1];
        return { ...state, right: nextActive, rightTabs: tabs };
      }
      const nextTabs = tabs.length > 0 ? tabs : [{ kind: 'library' } as WorkspaceSurface];
      const nextActive = surfaceKey(state.left) !== action.key ? state.left : nextTabs[nextTabs.length - 1];
      return { ...state, left: nextActive, leftTabs: nextTabs };
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
        const targetIndex = clampTabIndex(action.targetIndex, tabsWithoutSurface.length);
        const reorderedTabs = insertSurface(tabsWithoutSurface, surface, targetIndex);
        return sourcePane === 'left'
          ? { ...state, leftTabs: reorderedTabs }
          : { ...state, rightTabs: reorderedTabs };
      }

      const destinationTabs = action.pane === 'left' ? state.leftTabs : state.rightTabs;
      const nextSourceTabs = sourceTabs.filter((tab) => surfaceKey(tab) !== action.key);
      const nextDestinationTabs = destinationTabs.filter((tab) => surfaceKey(tab) !== action.key);
      const targetIndex = clampTabIndex(action.targetIndex, nextDestinationTabs.length);
      const orderedDestinationTabs = insertSurface(nextDestinationTabs, surface, targetIndex);

      if (sourcePane === 'left') {
        const leftTabs = nextSourceTabs.length > 0
          ? nextSourceTabs
          : [{ kind: 'library' } as WorkspaceSurface];
        const left = surfaceKey(state.left) === action.key ? leftTabs[leftTabs.length - 1] : state.left;
        return {
          ...state,
          focusedPane: 'right',
          left,
          leftTabs,
          right: surface,
          rightTabs: orderedDestinationTabs
        };
      }

      const rightTabs = nextSourceTabs;
      const right = rightTabs.length > 0
        ? (state.right && surfaceKey(state.right) !== action.key ? state.right : rightTabs[rightTabs.length - 1])
        : null;
      return {
        ...state,
        focusedPane: 'left',
        left: surface,
        leftTabs: orderedDestinationTabs,
        right,
        rightTabs
      };
    }
    case 'removeEntry': {
      const isOtherEntry = (surface: WorkspaceSurface) =>
        !('entryId' in surface) || surface.entryId !== action.entryId;
      const remainingLeftTabs = state.leftTabs.filter(isOtherEntry);
      const leftTabs = remainingLeftTabs.length > 0
        ? remainingLeftTabs
        : [{ kind: 'library' } as WorkspaceSurface];
      const left = isOtherEntry(state.left) ? state.left : leftTabs[leftTabs.length - 1];
      const rightTabs = state.rightTabs.filter(isOtherEntry);
      const right = rightTabs.length === 0
        ? null
        : state.right && isOtherEntry(state.right)
          ? state.right
          : rightTabs[rightTabs.length - 1];
      return {
        ...state,
        focusedPane: state.focusedPane === 'right' && !right ? 'left' : state.focusedPane,
        left,
        leftTabs,
        right,
        rightTabs
      };
    }
    case 'closeOthers': {
      const tabs = action.pane === 'left' ? state.leftTabs : state.rightTabs;
      const surface = tabs.find((tab) => surfaceKey(tab) === action.key);
      if (!surface) return state;
      return action.pane === 'left'
        ? { ...state, focusedPane: 'left', left: surface, leftTabs: [surface] }
        : { ...state, focusedPane: 'right', right: surface, rightTabs: [surface] };
    }
    case 'closePane':
      return action.pane === 'right'
        ? { ...state, focusedPane: 'left', right: null, rightTabs: [] }
        : { ...state, focusedPane: 'left', left: { kind: 'library' }, leftTabs: [{ kind: 'library' }] };
    case 'removeNote': {
      const isDeletedNote = (surface: WorkspaceSurface) =>
        surface.kind === 'note' && surface.entryId === action.entryId && surface.noteId === action.noteId;
      const remainingLeftTabs = state.leftTabs.filter((surface) => !isDeletedNote(surface));
      const leftTabs = remainingLeftTabs.length > 0
        ? remainingLeftTabs
        : [{ kind: 'library' } as WorkspaceSurface];
      const left = isDeletedNote(state.left) ? leftTabs[leftTabs.length - 1] : state.left;
      const rightTabs = state.rightTabs.filter((surface) => !isDeletedNote(surface));
      const right = rightTabs.length === 0
        ? null
        : state.right && !isDeletedNote(state.right)
          ? state.right
          : rightTabs[rightTabs.length - 1];
      return {
        ...state,
        focusedPane: state.focusedPane === 'right' && !right ? 'left' : state.focusedPane,
        left,
        leftTabs,
        right,
        rightTabs
      };
    }
    case 'closeRight':
      return { ...state, focusedPane: 'left', right: null, rightTabs: [] };
    case 'swap':
      return state.right
        ? {
            focusedPane: state.focusedPane === 'left' ? 'right' : 'left',
            left: state.right,
            leftTabs: state.rightTabs,
            right: state.left,
            rightTabs: state.leftTabs
          }
        : state;
  }
}

function findSurfacePane(state: WorkspaceSurfaceLayout, key: string): WorkspacePaneId | null {
  if (state.leftTabs.some((surface) => surfaceKey(surface) === key)) {
    return 'left';
  }
  return state.rightTabs.some((surface) => surfaceKey(surface) === key) ? 'right' : null;
}

function clampTabIndex(index: number | undefined, length: number) {
  return Math.min(length, Math.max(0, index ?? length));
}

function insertSurface(tabs: WorkspaceSurface[], surface: WorkspaceSurface, index: number) {
  return [...tabs.slice(0, index), surface, ...tabs.slice(index)];
}

export function surfaceKey(surface: WorkspaceSurface) {
  switch (surface.kind) {
    case 'note': return `note:${surface.entryId}:${surface.noteId}`;
    case 'segment-notes': case 'annotations': return `segment-records:${surface.entryId}`;
    case 'library': case 'settings': case 'create-entry': case 'mineru-client-guide': case 'tag-editor': return surface.kind;
    default: return `${surface.kind}:${surface.entryId}`;
  }
}

export function entryContentSurface(entryId: string, contentId: string): WorkspaceSurface {
  if (contentId === 'pdf') return { kind: 'pdf', entryId };
  if (contentId === 'reflow') return { kind: 'reflow', entryId };
  if (contentId === 'overview') return { kind: 'entry-overview', entryId };
  if (contentId === 'segment-notes') return { kind: 'segment-notes', entryId };
  if (contentId === 'annotations') return { kind: 'annotations', entryId };
  if (contentId === 'source-links') return { kind: 'source-links', entryId };
  if (contentId === 'entry-trash') return { kind: 'entry-trash', entryId };
  if (contentId.startsWith('note:')) return { kind: 'note', entryId, noteId: contentId.slice(5) };
  return { kind: 'entry-overview', entryId };
}

export function entryContentId(surface: WorkspaceSurface) {
  switch (surface.kind) {
    case 'pdf': return 'pdf';
    case 'reflow': return 'reflow';
    case 'entry-overview': return 'overview';
    case 'segment-notes': return 'segment-notes';
    case 'annotations': return 'annotations';
    case 'source-links': return 'source-links';
    case 'entry-trash': return 'entry-trash';
    case 'note': return `note:${surface.noteId}`;
    default: return null;
  }
}
