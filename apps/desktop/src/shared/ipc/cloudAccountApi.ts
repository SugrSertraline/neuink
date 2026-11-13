import { runLocalBackgroundJob } from '../lib/localBackgroundJobs';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { sameWorkspacePath } from '../lib/workspacePath';

export type CloudAccount = { endpoint: string; server_id: string; account_id: string | null; username: string | null };
export type CloudDevice = { id: string; name: string; current: boolean };
export type CloudLibrary = { id: string; name: string; revision: number };
export type CloudSyncPreview = {
  files: { path: string; size: number }[];
  logical_bytes: number;
  unique_bytes: number;
  omitted_files: number;
  omitted_bytes: number;
  validated_entities: number;
  validated_attachment_bytes: number;
  entries: { entry_id: string; entity_count: number; issue: string | null; notices: { code: string; entity_id: string; message: string }[] }[];
};
export type CloudSyncState = {
  conflict_count?: number | null;
  conflict_error?: string | null;
  root: string;
  binding: { server_id: string; account_id: string; library_id: string; epoch: string } | null;
  control: { paused: boolean };
  schedule: { blocked: boolean; retry_at: number | null };
  task: {
    id: number;
    progress: { phase: string; scanned?: number; scan_total?: number; confirmed_bytes: number; total_bytes: number; published: number; received: number; applied: number };
    running: boolean; cancelled: boolean; error: string | null;
    result: { pending?: number; uploads_blocked?: boolean; published: number; received: number; applied: number; conflicts: number; failures: [string, string][] } | null;
  };
};
export type AccountRequest =
  | { action: 'sync_cloud_contents'; root: string }
  | { action: 'sync_entry_status'; root: string }
  | { action: 'sync_status' }
  | { action: 'recovery_inspect' | 'recovery_retry' }
  | { action: 'recovery_keep_current'; name: string; token: string }
  | { action: 'sync_rebaseline'; root: string; token?: string }
  | { action: 'sync_conflicts'; root: string }
  | { action: 'sync_deletion_group'; root: string; id: string }
  | { action: 'sync_resolve_deletion_group'; root: string; id: string; token: string; keep_local: boolean }
  | { action: 'sync_conflict_notes'; root: string; id: string }
  | { action: 'sync_merge_note'; root: string; id: string; token: string; markdown: string }
  | { action: 'sync_conflict'; root: string; id: string }
  | { action: 'sync_resolve'; root: string; id: string; token: string; keep_local: boolean }
  | { action: 'sync_run' | 'sync_cancel' | 'sync_preview' | 'sync_auto' | 'sync_wake'; root: string }
  | { action: 'sync_pause'; root: string; paused: boolean }
  | { action: 'sync_cloud_preview'; root: string; library_id: string }
  | { action: 'sync_bind'; root: string; library_id: string; token: string }
  | { action: 'profile' | 'storage' | 'storage_cleanup_preview' }
  | { action: 'storage_cleanup'; token: string }
  | { action: 'save_profile'; profile: CloudProfile }
  | { action: 'status' | 'logout' | 'devices' | 'default_library' | 'libraries' | 'invite' | 'preview' }
  | { action: 'connect'; endpoint: string }
  | { action: 'login'; username: string; password: string; device_name: string }
  | { action: 'register'; username: string; password: string; invite: string }
  | { action: 'create_library'; name: string }
  | { action: 'revoke'; id: string }
  | { action: 'admin_reset_password'; new_password: string }
  | { action: 'password'; old_password: string; new_password: string };

export function cloudAccount<T>(request: AccountRequest): Promise<T> {
  const titles: Partial<Record<AccountRequest['action'], string>> = {
    connect: '连接同步服务器',
    sync_cloud_contents: '读取云端内容',
    storage_cleanup: '清理云端旧版本', sync_rebaseline: '重新核对同步资料',
    sync_resolve: '处理同步冲突', sync_merge_note: '合并同步笔记',
    sync_resolve_deletion_group: '处理同步删除冲突', recovery_retry: '恢复资料库写入',
    recovery_keep_current: '确认资料库恢复', sync_preview: '核对本地同步内容', sync_cloud_preview: '核对云端同步内容',
  };
  const title = titles[request.action];
  if (!title) return invoke<T>('cloud_account', { request });
  return runLocalBackgroundJob({ kind: 'sync', scope: 'root' in request ? { kind: 'workspace', root: request.root } : null,
    idPrefix: `cloud-maintenance:${request.action}`, message: `${title}：处理中`, successMessage: `${title}已完成`,
    failureMessage: `${title}未完成，请返回账户设置核对`,
  }, () => invoke<T>('cloud_account', { request }));
}

export type CloudProfile = {
  username: string; nickname: string; full_name: string; email: string;
  bio: string; affiliation: string; avatar?: string; profile_revision: number; admin: boolean;
};
export type CloudStorage = {
  quota: number; used_bytes: number; reserved_bytes: number; available_bytes: number;
  file_bytes: number; metadata_bytes: number;
};

export function onCloudLibraryChanged(root: string, onChange: () => void, onError: (error: unknown) => void) {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  let closed = false;
  let unlisten: (() => void) | undefined;
  void listen<{ root: string }>('cloud-library-changed', event => {
    if (!closed && sameWorkspacePath(event.payload.root, root)) onChange();
  }).then(stop => { if (closed) stop(); else unlisten = stop; })
    .catch(error => { if (!closed) onError(error); });
  return () => { closed = true; unlisten?.(); };
}

export type CloudConflict = {
  notes?: [CloudConflictNote | null, CloudConflictNote | null, CloudConflictNote | null];
  base: unknown; local: unknown;
  remote: { object_id: string; content: unknown; deleted: boolean; revision: number };
  token: string;
};

export type CloudConflictNote = { title: string; markdown: string };

export type CloudBindingPreview = {
  token: string; entities: number; new_attachment_bytes: number; existing_attachment_bytes: number;
  metadata_estimate_bytes: number; overlapping_objects: number; available_bytes: number;
  issues: [string, string][]; omitted_scope: string[];
};
