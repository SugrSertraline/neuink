import { createContext, useContext, useRef } from 'react';
import { EditRecoveryNotice } from '../components/EditRecoveryNotice';
import { readEditRecoverySecrets, type EditRecoveryDraft } from '../ipc/editRecoveryApi';
import { checkpointEditRecovery, recoveryDraftKey } from '../lib/editRecovery';
import { useEditRecovery } from './useEditRecovery';

export const EditRecoveryRoot = createContext<string | null>(null);

/** Form values remain owned by their original editor. Secrets only cross IPC to the OS vault. */
export function useFormRecovery<T>({ kind = 'settings', id, label, scope = 'settings', ownerId = 'settings', targetId = id,
  root: suppliedRoot, value, dirty, ready = true, secretFields = [], restore, reveal }: {
  kind?: EditRecoveryDraft['kind']; id: string; label: string; scope?: string; ownerId?: string; targetId?: string;
  root?: string | null; value: T; dirty: boolean; ready?: boolean; secretFields?: string[];
  restore: (value: T) => void; reveal?: () => void;
}) {
  const inheritedRoot = useContext(EditRecoveryRoot), root = suppliedRoot === undefined ? inheritedRoot : suppliedRoot;
  const publicValue = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value;
  const secrets: Record<string, string> = {};
  for (const field of secretFields) {
    const record = publicValue as Record<string, unknown>;
    if (typeof record[field] === 'string' && record[field]) secrets[field] = record[field];
    delete record[field];
  }
  const draft = { key: recoveryDraftKey(kind, ownerId, id), kind, label, ownerId, targetId, scopeKey: scope,
    payload: { value: publicValue }, ...(Object.keys(secrets).length ? { secrets } : {}) };
  const recovery = useEditRecovery({ root, draft, dirty, ready, allowKeyMigration: kind !== 'settings', restore: async (snapshot, isCurrent) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot.payload, 'value')) throw new Error('恢复格式无效');
    const protectedValues = snapshot.secretRef ? await readEditRecoverySecrets(root!, snapshot.key, snapshot.secretRef) : snapshot.secrets ?? {};
    if (!isCurrent()) return;
    const next = snapshot.payload.value;
    restore((secretFields.length ? { ...next as object, ...Object.fromEntries(secretFields.map(field => [field, protectedValues[field] ?? ''])) } : next) as T);
  } });
  const current = useRef({ root, recovery, draft, dirty, ready, reveal, label });
  current.current = { root, recovery, draft, dirty, ready, reveal, label };
  const handlers = {
    label: () => current.current.label,
    reveal: () => current.current.reveal?.(),
    recovery: () => current.current.recovery.reference,
    checkpoint: () => { const c = current.current; if (c.root && c.ready && c.dirty && !c.recovery.pending) checkpointEditRecovery(c.root, c.draft); },
  };
  return { ...recovery, handlers, blocked: Boolean(recovery.pending || recovery.loading || recovery.restoring),
    notice: <EditRecoveryNotice recovery={recovery} /> };
}
