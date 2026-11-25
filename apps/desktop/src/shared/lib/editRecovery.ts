import { isTauri } from '@tauri-apps/api/core';
import { readEditRecovery, removeEditRecovery, writeEditRecovery, type EditRecoveryDraft } from '../ipc/editRecoveryApi';

type Store = {
  drafts: Map<string, EditRecoveryDraft>; restorable: Map<string, EditRecoveryDraft>; pending: Map<string, EditRecoveryDraft | null>;
  touched: Set<string>; loaded: boolean; load?: Promise<void>; writing?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>; error: string | null; unreadable: number;
  requested?: string;
};
const stores = new Map<string, Store>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(listener => listener()); };
export const subscribeEditRecovery = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const editRecoveryVersion = () => version;
function store(root: string): Store {
  let value = stores.get(root);
  if (!value) { value = { drafts: new Map(), restorable: new Map(), pending: new Map(), touched: new Set(), loaded: false, error: null, unreadable: 0 }; stores.set(root, value); }
  return value;
}
export const recoveryAvailable = () => isTauri();
export const recoveryState = (root: string) => store(root);
export const recoveryDraftKey = (kind: EditRecoveryDraft['kind'], ...ids: string[]) => JSON.stringify([kind, ...ids]);

export async function loadEditRecovery(root: string) {
  const state = store(root);
  if (state.loaded) return;
  if (!state.load) state.load = (async () => {
    try {
      const result = await readEditRecovery(root);
      for (const draft of result.drafts) if (!state.touched.has(draft.key)) { state.drafts.set(draft.key, draft); state.restorable.set(draft.key, draft); }
      state.unreadable = result.unreadable; state.loaded = true; state.error = null;
    } catch { state.error = '本地草稿读取失败，请检查文献库是否可写后重试。'; throw new Error(state.error); }
    finally { state.load = undefined; emit(); }
  })();
  return state.load;
}

export function checkpointEditRecovery(root: string, input: Omit<EditRecoveryDraft, 'updatedAt'>) {
  const state = store(root);
  const previous = state.drafts.get(input.key);
  if (previous && JSON.stringify({ ...previous, updatedAt: undefined }) === JSON.stringify({ ...input, updatedAt: undefined })) return;
  const draft = { ...input, updatedAt: new Date().toISOString() };
  state.touched.add(draft.key); state.drafts.set(draft.key, draft); state.pending.set(draft.key, draft);
  schedule(root, state); emit();
}
export function forgetEditRecovery(root: string, key: string) {
  const state = store(root);
  state.touched.add(key); state.drafts.delete(key); state.restorable.delete(key); state.pending.set(key, null);
  schedule(root, state); emit();
}
export function claimEditRecovery(root: string, key: string) { store(root).restorable.delete(key); emit(); }
export function requestEditRecovery(root: string, key: string) { store(root).requested = key; emit(); }
function schedule(root: string, state: Store) {
  // Bounded delay: continuous typing cannot postpone the checkpoint indefinitely.
  if (!state.timer) state.timer = setTimeout(() => {
    state.timer = undefined; void flushEditRecovery(root).catch(() => { /* Error stays visible in the recovery UI. */ });
  }, 250);
}
export async function flushEditRecovery(root: string): Promise<void> {
  const state = store(root);
  clearTimeout(state.timer); state.timer = undefined;
  await loadEditRecovery(root);
  if (state.writing) { await state.writing; if (state.pending.size) return flushEditRecovery(root); return; }
  const operation = (async () => {
    try {
      while (state.pending.size) {
        const [key, snapshot] = state.pending.entries().next().value!;
        if (snapshot) await writeEditRecovery(root, snapshot); else await removeEditRecovery(root, key);
        // A newer edit/removal that arrived during the write must still be persisted.
        if (state.pending.get(key) === snapshot) state.pending.delete(key);
      }
      state.error = null;
    } catch { state.error = '本地草稿备份失败，修改仍保留在编辑器中，请勿强制关闭。'; throw new Error(state.error); }
    finally { emit(); }
  })();
  state.writing = operation;
  try { await operation; } finally { if (state.writing === operation) state.writing = undefined; }
}
export async function flushAllEditRecovery() {
  for (const [root, state] of stores) if (state.pending.size || state.writing) await flushEditRecovery(root);
}
export const hasPendingEditRecovery = () => [...stores.values()].some(state => state.pending.size > 0 || Boolean(state.writing));
export function isRecoveryBackedUp(root: string, key: string) {
  const state = store(root);
  return state.loaded && !state.error && !state.pending.has(key) && state.drafts.has(key);
}

// Only an explicit, fully checkpointed exit may bypass the editors' unload guards.
let recoveryExit = false;
export const isRecoveryExit = () => recoveryExit;
export const setRecoveryExit = (allowed: boolean) => { recoveryExit = allowed; };
