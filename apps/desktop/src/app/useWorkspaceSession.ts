import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntryMeta, TagMeta } from '@/shared/types/domain';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceReducer, type WorkspaceSurfaceAction } from './workspaceSurface';
import { readWorkspaceSession, saveWorkspaceSession } from './workspaceSession';

export function useWorkspaceSession({ root, status, entries, tags, onSaveError }: {
  root: string | null; status: 'loading' | 'ready' | 'error'; entries: EntryMeta[]; tags: TagMeta[]; onSaveError: () => void;
}) {
  const [session, setSession] = useState({ root: null as string | null, layout: initialWorkspaceSurfaceLayout });
  // Reset before children render against a new root. An effect would briefly mount
  // the old library's readers and could save its tabs under the new library's key.
  if (root && status === 'ready' && session.root !== root) {
    setSession({ root, layout: readWorkspaceSession(root, { entries, tags }) });
  }
  const onError = useRef(onSaveError); onError.current = onSaveError;
  const reportedFailure = useRef(false);
  useEffect(() => {
    if (!root || status !== 'ready' || session.root !== root) return;
    const save = () => {
      if (saveWorkspaceSession(root, session.layout)) reportedFailure.current = false;
      else if (!reportedFailure.current) { reportedFailure.current = true; onError.current(); }
    };
    save();
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, [root, status, session]);
  const dispatch = useCallback((action: WorkspaceSurfaceAction) => setSession(current => {
    const layout = workspaceSurfaceReducer(current.layout, action);
    return layout === current.layout ? current : { ...current, layout };
  }), []);
  return [session.layout, dispatch] as const;
}
