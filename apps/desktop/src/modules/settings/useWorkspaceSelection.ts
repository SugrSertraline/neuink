import { useToast } from '@/shared/hooks/useToast';
import {
  getWorkspaceSettings,
  inspectWorkspacePath,
  type WorkspacePathInspection,
  type WorkspaceSettings
} from '@/shared/ipc/workspaceApi';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import { resolveWorkspaceSelection, type WorkspaceSelectionIntent } from './workspaceSelection';

export type PendingWorkspaceAction = {
  intent: WorkspaceSelectionIntent;
  inspection: WorkspacePathInspection;
};

export type WorkspaceChangeCallbacks = {
  onBeforeWorkspaceChange?: () => Promise<void>;
  onSwitchWorkspaceRoot?: (root: string) => Promise<void>;
  onCreateWorkspaceRoot?: (root: string) => Promise<void>;
  onResetWorkspaceRoot?: () => Promise<void>;
};

// The mounted settings page owns this flow; inspection never switches or writes a workspace.
export function useWorkspaceSelection({
  onBeforeWorkspaceChange,
  onSwitchWorkspaceRoot,
  onCreateWorkspaceRoot,
  onResetWorkspaceRoot,
  onWorkspaceSettingsChanged: setWorkspaceSettings,
  onFailure: notifyFailure
}: WorkspaceChangeCallbacks & {
  onWorkspaceSettingsChanged: (settings: WorkspaceSettings) => void;
  onFailure: (title: string, error: unknown) => void;
}) {
  const { notify } = useToast();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [pendingWorkspaceAction, setPendingWorkspaceAction] = useState<PendingWorkspaceAction | null>(null);

  const chooseWorkspaceFolder = async (intent: PendingWorkspaceAction['intent']) => {
    const selected = await open({
      directory: true,
      multiple: false
    });
    if (typeof selected !== 'string') {
      return;
    }
    setWorkspaceBusy(true);
    try {
      const inspection = await inspectWorkspacePath(selected);
      const resolution = resolveWorkspaceSelection(intent, inspection);
      if ('intent' in resolution) {
        setPendingWorkspaceAction({ intent: resolution.intent, inspection });
      } else {
        notify({ tone: 'danger', title: '无法使用所选工作区', description: resolution.message });
      }
    } catch (caught) {
      notifyFailure('检查工作区失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const inspectAndOpenRecentWorkspace = async (root: string) => {
    setWorkspaceBusy(true);
    try {
      const inspection = await inspectWorkspacePath(root);
      if (inspection.kind === 'valid_workspace') {
        setPendingWorkspaceAction({ intent: 'switch', inspection });
      } else {
        notify({ tone: 'danger', title: '无法打开最近工作区', description: inspection.message });
      }
    } catch (caught) {
      notifyFailure('检查最近工作区失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const confirmWorkspaceAction = async () => {
    if (!pendingWorkspaceAction) {
      return;
    }
    setWorkspaceBusy(true);
    try {
      await onBeforeWorkspaceChange?.();
      const { inspection, intent } = pendingWorkspaceAction;
      if (intent === 'switch') {
        if (!onSwitchWorkspaceRoot) {
          throw new Error('当前窗口不支持切换工作区。');
        }
        await onSwitchWorkspaceRoot(inspection.root);
        notify({ tone: 'success', title: '已切换工作区' });
      } else if (intent === 'create') {
        if (!onCreateWorkspaceRoot) {
          throw new Error('当前窗口不支持新建工作区。');
        }
        await onCreateWorkspaceRoot(inspection.root);
        notify({ tone: 'success', title: '已新建并打开工作区' });
      }
      setPendingWorkspaceAction(null);
      setWorkspaceSettings(await getWorkspaceSettings());
    } catch (caught) {
      notifyFailure('工作区操作失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const resetWorkspaceRoot = async () => {
    if (!onResetWorkspaceRoot) {
      return;
    }
    setWorkspaceBusy(true);
    try {
      await onBeforeWorkspaceChange?.();
      await onResetWorkspaceRoot();
      const nextWorkspaceSettings = await getWorkspaceSettings();
      setWorkspaceSettings(nextWorkspaceSettings);
      notify({ tone: 'success', title: '已打开默认工作区' });
    } catch (caught) {
      notifyFailure('打开默认工作区失败', caught);
    } finally {
      setWorkspaceBusy(false);
    }
  };

  return {
    workspaceBusy, pendingWorkspaceAction,
    chooseWorkspaceFolder, inspectAndOpenRecentWorkspace, confirmWorkspaceAction, resetWorkspaceRoot,
    cancelWorkspaceAction: () => { if (!workspaceBusy) setPendingWorkspaceAction(null); }
  };
}
