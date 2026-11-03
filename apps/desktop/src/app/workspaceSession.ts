import type { EntryMeta, TagMeta } from '@/shared/types/domain';
import { readWorkspaceStorage, workspaceStorageIdentity } from '@/shared/lib/workspaceStorageIdentity';
import { emptyWorkspaceSurfaceLayout, initialWorkspaceSurfaceLayout, surfaceKey, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';

const VERSION = 1;
const MAX_TABS = 80;
const storageKey = (root: string) => `neuink.workspace.session:${workspaceStorageIdentity(root)}`;
type Catalog = { entries: Pick<EntryMeta, 'id' | 'pdf' | 'contents'>[]; tags: Pick<TagMeta, 'id'>[] };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;

/** Store reopenable identities only. Drafts, review decisions and live requests never enter this snapshot. */
function savedSurface(value: unknown): WorkspaceSurface | null {
  if (!record(value)) return null;
  const view = id(value.viewId) ? { viewId: value.viewId } : {};
  switch (value.kind) {
    case 'external-import': case 'daily-dashboard': case 'library': case 'relations': case 'mineru-client-guide': case 'tag-editor':
      return { kind: value.kind };
    case 'tag-reading': case 'tag-details':
      return id(value.tagId) ? { kind: value.kind, tagId: value.tagId,
        ...(id(value.label) ? { label: value.label } : {}),
        ...(value.kind === 'tag-details' && ['overview', 'papers', 'notes'].includes(String(value.view))
          ? { view: value.view as 'overview' | 'papers' | 'notes' } : {}) } : null;
    case 'pdf': case 'reflow': case 'entry-overview':
      return id(value.entryId) ? { kind: value.kind, entryId: value.entryId, ...view,
        ...(id(value.contextTagId) ? { contextTagId: value.contextTagId } : {}) } : null;
    case 'note':
      return id(value.entryId) && id(value.noteId) ? { kind: 'note', entryId: value.entryId, noteId: value.noteId, ...view } : null;
    case 'segment-notes':
      return id(value.entryId) ? { kind: 'segment-notes', entryId: value.entryId, ...view,
        ...(id(value.segmentUid) ? { segmentUid: value.segmentUid } : {}),
        ...(value.mode === 'note' || value.mode === 'annotation' ? { mode: value.mode } : {}) } : null;
    case 'source-links': case 'entry-trash':
      return id(value.entryId) ? { kind: value.kind, entryId: value.entryId } : null;
    case 'owned-note': {
      const target = value.target;
      if (!record(target) || !record(target.owner) || !id(target.note_id)) return null;
      const owner = target.owner;
      if (owner.kind === 'entry' && id(owner.entry_id)) return { kind: 'note', entryId: owner.entry_id, noteId: target.note_id, ...view };
      if (owner.kind === 'daily' && typeof owner.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(owner.date) && target.note_id === 'journal') return { kind: 'owned-note', target: { owner: { kind: 'daily', date: owner.date }, note_id: 'journal' }, ...view };
      if (owner.kind !== 'tag_reading' || !id(owner.tag_id)) return null;
      return { kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: owner.tag_id }, note_id: target.note_id },
        ...(id(value.label) ? { label: value.label } : {}), ...view };
    }
    default: return null;
  }
}

function available(surface: WorkspaceSurface, catalog: Catalog): boolean {
  if ('tagId' in surface && !catalog.tags.some(tag => tag.id === surface.tagId)) return false;
  if ('entryId' in surface) {
    const entry = catalog.entries.find(entry => entry.id === surface.entryId);
    if (!entry) return false;
    if (surface.kind === 'pdf' && !entry.pdf) return false;
    if (surface.kind === 'note' && !entry.contents.some(item => item.note_id === surface.noteId)) return false;
  }
  const owner = surface.kind === 'owned-note' ? surface.target.owner : null;
  return owner?.kind !== 'tag_reading' || catalog.tags.some(tag => tag.id === owner.tag_id);
}

function normalizeLayout(value: Record<string, unknown>, catalog?: Catalog): WorkspaceSurfaceLayout {
  const seen = new Set<string>();
  const tabs = (input: unknown) => (Array.isArray(input) ? input.slice(0, MAX_TABS) : []).flatMap(item => {
    const surface = savedSurface(item);
    if (!surface || (catalog && !available(surface, catalog)) || seen.size >= MAX_TABS) return [];
    const key = surfaceKey(surface);
    if (seen.has(key)) return [];
    seen.add(key);
    return [surface];
  });
  let leftTabs = tabs(value.leftTabs), rightTabs = tabs(value.rightTabs);
  let leftKey = value.leftKey, rightKey = value.rightKey;
  if (!leftTabs.length && rightTabs.length) {
    leftTabs = rightTabs; rightTabs = []; leftKey = rightKey; rightKey = null;
  }
  if (!leftTabs.length && value.allowEmpty === true) return emptyWorkspaceSurfaceLayout;
  if (!leftTabs.length) leftTabs = [{ kind: 'library' }];
  const left = leftTabs.find(tab => surfaceKey(tab) === leftKey) ?? leftTabs[leftTabs.length - 1];
  const right = rightTabs.find(tab => surfaceKey(tab) === rightKey) ?? rightTabs[rightTabs.length - 1] ?? null;
  const open = new Set([...leftTabs, ...rightTabs].map(surfaceKey));
  return { leftTabs, rightTabs, left, right, focusedPane: value.focusedPane === 'right' && right ? 'right' : 'left',
    pinnedTabKeys: Array.isArray(value.pinnedTabKeys) ? [...new Set(value.pinnedTabKeys.filter((key): key is string => typeof key === 'string' && open.has(key)))].slice(0, MAX_TABS) : [] };
}

export function readWorkspaceSession(root: string, catalog: Catalog): WorkspaceSurfaceLayout {
  try {
    const raw = readWorkspaceStorage(storageKey(root));
    if (!raw || raw.length > 256_000) return initialWorkspaceSurfaceLayout;
    const value: unknown = JSON.parse(raw);
    return record(value) && value.version === VERSION ? normalizeLayout(value, catalog) : initialWorkspaceSurfaceLayout;
  } catch { return initialWorkspaceSurfaceLayout; }
}

export function saveWorkspaceSession(root: string, layout: WorkspaceSurfaceLayout): boolean {
  try {
    const snapshot = normalizeLayout({ ...layout, allowEmpty: true,
      leftKey: surfaceKey(layout.left), rightKey: layout.right ? surfaceKey(layout.right) : null });
    window.localStorage.setItem(storageKey(root), JSON.stringify({ version: VERSION, leftTabs: snapshot.leftTabs,
      rightTabs: snapshot.rightTabs, leftKey: surfaceKey(snapshot.left), rightKey: snapshot.right ? surfaceKey(snapshot.right) : null,
      focusedPane: snapshot.focusedPane, pinnedTabKeys: snapshot.pinnedTabKeys,
      allowEmpty: true }));
    return true;
  } catch { return false; }
}
