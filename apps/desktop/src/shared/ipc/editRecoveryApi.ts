import { invoke } from '@tauri-apps/api/core';

export type EditRecoveryDraft = {
  key: string;
  kind: 'note' | 'segment-note' | 'annotation' | 'settings' | 'entry' | 'create-entry' | 'tag-description' | 'todo' | 'tag-reading' | 'daily-state';
  label: string;
  ownerId: string;
  targetId: string;
  scopeKey: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  /** Vault reference on disk; plaintext secrets only exist in memory and in the write IPC. */
  secretRef?: string | null;
  secrets?: Record<string, string>;
};
export type EditRecoveryList = { drafts: EditRecoveryDraft[]; unreadable: number };
const command = (root: string, action: Record<string, unknown>) => invoke<EditRecoveryList>('edit_recovery', { request: { root, action } });
export const readEditRecovery = (root: string) => command(root, { kind: 'list' });
export const writeEditRecovery = (root: string, input: EditRecoveryDraft) => {
  const { secrets, ...draft } = input;
  return command(root, { kind: 'write', draft, secrets: secrets ?? {} });
};
export const readEditRecoverySecrets = (root: string, key: string, expectedRef: string) => invoke<Record<string, string>>('edit_recovery_secrets', { request: { root, key, expected_ref: expectedRef } });
export const removeEditRecovery = (root: string, key: string) => command(root, { kind: 'remove', key });
