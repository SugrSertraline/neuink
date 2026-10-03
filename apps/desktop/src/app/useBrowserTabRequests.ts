import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { BROWSER_OPEN_EVENT } from '@/modules/browser/browserUrl';
import { browserTabActionFromEvent, planWorkspaceBrowserTab, type BrowserTabOpenAction } from './workspaceBrowserTabs';
import { workspaceSurfaceReducer, type WorkspaceSurfaceAction, type WorkspaceSurfaceLayout } from './workspaceSurface';

export function useBrowserTabRequests(layout: WorkspaceSurfaceLayout, dispatch: Dispatch<WorkspaceSurfaceAction>,
  onError: (reason: 'limit' | 'invalid') => void) {
  const current = useRef({ layout, dispatch, onError });
  current.current = { layout, dispatch, onError };
  const open = useCallback((action: BrowserTabOpenAction) => {
    const owner = current.current;
    const result = planWorkspaceBrowserTab(owner.layout, action);
    if (result.status === 'limit' || result.status === 'invalid') { owner.onError(result.status); return; }
    if (result.status !== 'open') return;
    // Reserve the slot immediately, including multiple native events before React commits.
    owner.layout = workspaceSurfaceReducer(owner.layout, action);
    owner.dispatch(action);
  }, []);
  useEffect(() => {
    const receive = (event: Event) => {
      const action = browserTabActionFromEvent((event as CustomEvent).detail, crypto.randomUUID());
      if (action) open(action);
      else current.current.onError('invalid');
    };
    window.addEventListener(BROWSER_OPEN_EVENT, receive);
    return () => window.removeEventListener(BROWSER_OPEN_EVENT, receive);
  }, [open]);
  return useCallback(() => open({ type: 'openBrowser', id: crypto.randomUUID() }), [open]);
}
