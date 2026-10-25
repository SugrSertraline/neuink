declare global {
  interface Window { readonly __NEUINK_PORTABLE_DATA__?: string; readonly __NEUINK_PORTABLE_IMPORTED_ROOT__?: string | null; readonly __NEUINK_PORTABLE_IMPORTED_IDENTITY__?: string }
}

const normalize = (value: string) => value.replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Persist relative identities inside a portable profile so moving its folder preserves reading state. */
export function workspaceStorageIdentity(root: string): string {
  const portable = typeof window === 'undefined' ? undefined : window.__NEUINK_PORTABLE_DATA__;
  if (!portable) return root;
  const base = normalize(portable);
  const candidate = normalize(root);
  if (candidate === base) return 'portable:.';
  if (!candidate.startsWith(`${base}/`)) return root;
  const relative = candidate.slice(base.length + 1);
  if (relative.split('/').some(part => part === '..' || part === '.')) return root;
  return `portable:${relative}`;
}

/** Only imported tab/reading identities are migrated; existing portable state always wins. */
export function readWorkspaceStorage(key: string): string | null {
  const saved = window.localStorage.getItem(key);
  const imported = window.__NEUINK_PORTABLE_IMPORTED_ROOT__;
  const identity = window.__NEUINK_PORTABLE_IMPORTED_IDENTITY__ ?? 'portable:library';
  if (saved !== null || !window.__NEUINK_PORTABLE_DATA__ || !imported) return saved;
  let previousKey: string;
  if (key === `neuink.workspace.session:${identity}`) {
    previousKey = `neuink.workspace.session:${imported}`;
  } else if (key.startsWith('neuink.reading.view:')) {
    const parts: unknown = JSON.parse(key.slice('neuink.reading.view:'.length));
    if (!Array.isArray(parts) || parts.length !== 2 || parts[0] !== identity) return null;
    previousKey = `neuink.reading.view:${JSON.stringify([imported, parts[1]])}`;
  } else return null;
  let raw = window.localStorage.getItem(previousKey);
  if (!raw || raw.length > 256_000) return null;
  if (key.startsWith('neuink.reading.view:')) {
    const state = JSON.parse(raw);
    if (state?.positions && typeof state.positions === 'object' && !Array.isArray(state.positions)) {
      state.positions = Object.fromEntries(Object.entries(state.positions).map(([id, value]) => {
        try {
          const parts: unknown = JSON.parse(id);
          if (Array.isArray(parts) && ['pdf', 'reflow'].includes(parts[0]) && typeof parts[1] === 'string' && normalize(parts[1]) === normalize(imported)) {
            parts[1] = identity; return [JSON.stringify(parts), value];
          }
        } catch { /* Older non-JSON identities are preserved. */ }
        return [id, value];
      }));
      raw = JSON.stringify(state);
    }
  }
  window.localStorage.setItem(key, raw);
  return raw;
}
