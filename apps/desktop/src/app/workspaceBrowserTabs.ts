import { browserTitle, normalizeBrowserUrl, type BrowserTabSource } from '@/modules/browser/browserUrl';
import type { WorkspacePaneId, WorkspaceSurface, WorkspaceSurfaceLayout } from './workspaceSurface';

export const MAX_BROWSER_TABS = 8;
export const MAX_BROWSER_OPEN_REQUESTS = 128;
export type BrowserTabOpenAction = { type: 'openBrowser'; id: string; url?: string; source?: BrowserTabSource };
type BrowserSurface = Extract<WorkspaceSurface, { kind: 'browser' }>;
type BrowserOpenResult = { status: 'open'; pane: WorkspacePaneId; surface: BrowserSurface }
  | { status: 'ignored' | 'invalid' | 'limit' };

export function browserTabActionFromEvent(detail: unknown, id: string): BrowserTabOpenAction | null {
  if (typeof detail === 'string') return { type: 'openBrowser', id, url: detail };
  if (!detail || typeof detail !== 'object') return null;
  const value = detail as Record<string, unknown>;
  if (typeof value.url !== 'string' || typeof value.sourceId !== 'string' || !value.sourceId ||
      typeof value.requestId !== 'string' || !value.requestId) return null;
  return { type: 'openBrowser', id, url: value.url, source: { sourceId: value.sourceId, requestId: value.requestId } };
}

/** Visible source identity owns popup routing; sidebar or pane focus may already have changed. */
export function planWorkspaceBrowserTab(state: WorkspaceSurfaceLayout, action: BrowserTabOpenAction): BrowserOpenResult {
  const tabs = [...state.leftTabs, ...state.rightTabs];
  let pane: WorkspacePaneId = state.focusedPane === 'right' && state.right ? 'right' : 'left';
  if (action.source) {
    const sourcePane = (['left', 'right'] as const).find(candidate => {
      const current = state[candidate];
      return current?.kind === 'browser' && current.id === action.source!.sourceId;
    });
    if (!sourcePane) return { status: 'ignored' };
    const source = state[sourcePane] as BrowserSurface;
    if (source.openRequestIds?.includes(action.source.requestId)) return { status: 'ignored' };
    pane = sourcePane;
  }
  if (!action.id || tabs.some(tab => tab.kind === 'browser' && tab.id === action.id)) return { status: 'ignored' };
  let url: string | undefined;
  try { url = action.url === undefined ? undefined : normalizeBrowserUrl(action.url); }
  catch { return { status: 'invalid' }; }
  if (tabs.filter(tab => tab.kind === 'browser').length >= MAX_BROWSER_TABS) return { status: 'limit' };
  return { status: 'open', pane,
    surface: { kind: 'browser', id: action.id, ...(url ? { url, title: browserTitle(url) } : {}) } };
}
