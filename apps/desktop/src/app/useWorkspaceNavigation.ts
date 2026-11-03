import { useCallback } from 'react';
import { hasUnsavedSurface } from './editSafety';
import { workspaceSurfaceOpenActions, type WorkspacePaneId, type WorkspaceSurface, type WorkspaceSurfaceAction, type WorkspaceSurfaceLayout } from './workspaceSurface';

/** All explicit page entry points share placement, edit protection and page sidebar selection. */
export function useWorkspaceNavigation({ layout, dispatch, prepareSplit, onBlockedMove, onSelectPage }: {
  layout: WorkspaceSurfaceLayout;
  dispatch: (action: WorkspaceSurfaceAction) => void;
  prepareSplit: (surface: WorkspaceSurface) => void;
  onBlockedMove: () => void;
  onSelectPage: (page: 'library' | 'daily-dashboard') => void;
}) {
  return useCallback((surface: WorkspaceSurface, pane?: WorkspacePaneId) => {
    const actions = workspaceSurfaceOpenActions(layout, surface, pane);
    // Explicit pane requests may move an existing editor; preserve the same save guard as tab dragging.
    if (actions.some(action => action.type === 'move') && hasUnsavedSurface(surface)) {
      onBlockedMove();
      return false;
    }
    if (pane === 'right' && !layout.right) prepareSplit(surface);
    actions.forEach(action => dispatch(action));
    if (surface.kind === 'library' || surface.kind === 'daily-dashboard') onSelectPage(surface.kind);
    return true;
  }, [layout, dispatch, prepareSplit, onBlockedMove, onSelectPage]);
}
