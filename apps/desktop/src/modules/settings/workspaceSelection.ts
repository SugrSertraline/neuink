import type { WorkspacePathInspection } from '@/shared/ipc/workspaceApi';

export type WorkspaceSelectionIntent = 'switch' | 'create' | 'migrate';

export function resolveWorkspaceSelection(
  intent: WorkspaceSelectionIntent,
  inspection: WorkspacePathInspection
): { intent: WorkspaceSelectionIntent } | { message: string } {
  if (inspection.kind === 'same_as_current') {
    return { message: inspection.message };
  }
  if (intent === 'switch' && inspection.kind === 'valid_workspace') {
    return { intent: 'switch' };
  }
  if (intent === 'switch' && inspection.kind === 'empty_directory') {
    return { intent: 'create' };
  }
  if (intent === 'create' && inspection.kind === 'empty_directory') {
    return { intent: 'create' };
  }
  if (intent === 'migrate' && inspection.kind === 'empty_directory') {
    return { intent: 'migrate' };
  }
  if (intent === 'create' && inspection.kind === 'valid_workspace') {
    return { message: '该文件夹已经是 Neuink 工作区，请使用“打开其他工作区”。' };
  }
  return { message: inspection.message };
}
