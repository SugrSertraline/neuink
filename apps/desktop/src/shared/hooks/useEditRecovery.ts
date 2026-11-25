import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EditRecoveryDraft } from '../ipc/editRecoveryApi';
import { checkpointEditRecovery, claimEditRecovery, editRecoveryVersion, forgetEditRecovery, loadEditRecovery, recoveryAvailable, recoveryState, subscribeEditRecovery } from '../lib/editRecovery';

/** Editors own their content; this hook only checkpoints and offers a recovered snapshot.
 * Restoration is explicit, so a stale backup never replaces newer content automatically. */
export function useEditRecovery({ root, draft, dirty, ready = true, restore, allowKeyMigration = true }: {
  root: string | null; draft: Omit<EditRecoveryDraft, 'updatedAt'> | null; dirty: boolean; ready?: boolean;
  restore: (draft: EditRecoveryDraft, isCurrent: () => boolean) => void | Promise<void>;
  allowKeyMigration?: boolean;
}) {
  useSyncExternalStore(subscribeEditRecovery, editRecoveryVersion, editRecoveryVersion);
  const key = draft?.key ?? '';
  const active = Boolean(root && key && recoveryAvailable());
  const state = root && active ? recoveryState(root) : null;
  const handled = useRef(new Set<string>());
  const wrote = useRef(new Set<string>());
  const migrated = useRef(new Map<string, string>());
  const restoring = useRef(new Map<string, string>());
  const [recovered, setRecovered] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const liveIdentity = useRef('');
  const identity = JSON.stringify([root, key]);
  liveIdentity.current = identity;
  useEffect(() => { liveIdentity.current = identity; return () => { if (liveIdentity.current === identity) liveIdentity.current = ''; }; }, [identity]);
  const requested = state?.requested ? state.restorable.get(state.requested) : undefined;
  const candidate = requested && draft && (allowKeyMigration || requested.key === key) && requested.kind === draft.kind && requested.ownerId === draft.ownerId && requested.targetId === draft.targetId ? requested : state?.restorable.get(key);
  const existing = active && state?.loaded && !handled.current.has(identity) && !wrote.current.has(identity) ? candidate : undefined;
  useEffect(() => { if (root && active) void loadEditRecovery(root).catch(() => {}); }, [root, active]);
  useEffect(() => {
    if (!active || !root || !draft || !ready || !state?.loaded || existing) return;
    if (dirty) {
      checkpointEditRecovery(root, draft); wrote.current.add(identity);
      const oldKey = migrated.current.get(identity);
      if (oldKey && oldKey !== key) { forgetEditRecovery(root, oldKey); migrated.current.delete(identity); }
    }
    else if (wrote.current.delete(identity) || restoring.current.get(identity) === JSON.stringify(draft.payload)) {
      forgetEditRecovery(root, key);
      const oldKey = migrated.current.get(identity);
      if (oldKey && oldKey !== key) forgetEditRecovery(root, oldKey);
      migrated.current.delete(identity); restoring.current.delete(identity); setRecovered(null);
    }
  }, [root, active, draft, dirty, ready, state?.loaded, existing, identity, key]);
  return {
    pending: existing,
    loading: active && !state?.loaded && !state?.error,
    error: restoreError ?? state?.error ?? null,
    recovered: recovered === identity,
    restoring: isRestoring,
    restore: async () => {
      if (!existing || !ready || isRestoring) return;
      setIsRestoring(true);
      try {
        const result = restore(existing, () => liveIdentity.current === identity); if (result) await result;
        if (liveIdentity.current !== identity) return;
        handled.current.add(identity); migrated.current.set(identity, existing.key);
        restoring.current.set(identity, JSON.stringify(existing.payload));
        claimEditRecovery(root!, existing.key); setRecovered(identity); setRestoreError(null);
      }
      catch { setRestoreError('草稿或安全凭据无法恢复，记录仍保留。请在原电脑登录原账户后重试，或查看并复制非敏感内容。'); }
      finally { setIsRestoring(false); }
    },
    discard: () => {
      if (!root) return;
      handled.current.add(identity); wrote.current.delete(identity); forgetEditRecovery(root, key); setRecovered(null); setRestoreError(null);
    },
    reference: active && root ? { root, key } : undefined,
  };
}
