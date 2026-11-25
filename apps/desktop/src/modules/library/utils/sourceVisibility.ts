import type { EntrySourceInfo } from '@/shared/ipc/workspaceApi';

export type EnabledLibrarySources = { zotero: boolean; mineru: boolean };

export function isEntrySourceHidden(source: EntrySourceInfo | undefined): boolean {
  return source?.hidden ?? source?.zotero_hidden ?? false;
}

export function isSourceEntryVisible(source: EntrySourceInfo | undefined, enabled: EnabledLibrarySources): boolean {
  return !source?.kinds.length || source.kinds.some(kind => enabled[kind]);
}
