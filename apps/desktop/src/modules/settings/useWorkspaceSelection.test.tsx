// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { open } from '@tauri-apps/plugin-dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWorkspaceSettings,
  inspectWorkspacePath,
  type WorkspacePathInspection,
  type WorkspaceSettings
} from '@/shared/ipc/workspaceApi';
import { useWorkspaceSelection } from './useWorkspaceSelection';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({
  getWorkspaceSettings: vi.fn(), inspectWorkspacePath: vi.fn()
}));
const notify = vi.hoisted(() => vi.fn());
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify }) }));

const inspection: WorkspacePathInspection = {
  root: 'D:\\Library', kind: 'valid_workspace', entry_count: 2,
  trashed_entry_count: 0, message: 'valid'
};
const settings: WorkspaceSettings = {
  root: inspection.root, default_root: 'default', custom_root: inspection.root,
  recent_workspaces: [], translation_automation: { auto_translate_pdf: false, segment_types: [] }
};
function setup() {
  const options = {
    onBeforeWorkspaceChange: vi.fn(async () => {}),
    onSwitchWorkspaceRoot: vi.fn(async (_root: string) => {}),
    onCreateWorkspaceRoot: vi.fn(async (_root: string) => {}),
    onResetWorkspaceRoot: vi.fn(async () => {}),
    onWorkspaceSettingsChanged: vi.fn(),
    onFailure: vi.fn()
  };
  return { ...renderHook(() => useWorkspaceSelection(options)), options };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(open).mockResolvedValue(inspection.root);
  vi.mocked(inspectWorkspacePath).mockResolvedValue(inspection);
  vi.mocked(getWorkspaceSettings).mockResolvedValue(settings);
});
afterEach(cleanup);

describe('workspace selection lifecycle', () => {
  it('only switches after confirmation and the unsaved-content guard, then refreshes settings', async () => {
    const { result, options } = setup();
    await act(() => result.current.chooseWorkspaceFolder('switch'));
    expect(result.current.pendingWorkspaceAction).toEqual({ intent: 'switch', inspection });
    expect(options.onSwitchWorkspaceRoot).not.toHaveBeenCalled();
    await act(() => result.current.confirmWorkspaceAction());
    expect(options.onSwitchWorkspaceRoot).toHaveBeenCalledWith(inspection.root);
    expect(options.onBeforeWorkspaceChange.mock.invocationCallOrder[0])
      .toBeLessThan(options.onSwitchWorkspaceRoot.mock.invocationCallOrder[0]);
    expect(options.onWorkspaceSettingsChanged).toHaveBeenCalledWith(settings);
    expect(result.current.pendingWorkspaceAction).toBeNull();
    expect(result.current.workspaceBusy).toBe(false);
  });

  it('offers creation for an empty directory without creating on inspection or cancellation', async () => {
    vi.mocked(inspectWorkspacePath).mockResolvedValue({ ...inspection, kind: 'empty_directory' });
    const { result, options } = setup();
    await act(() => result.current.chooseWorkspaceFolder('switch'));
    expect(result.current.pendingWorkspaceAction?.intent).toBe('create');
    act(() => result.current.cancelWorkspaceAction());
    expect(result.current.pendingWorkspaceAction).toBeNull();
    expect(options.onCreateWorkspaceRoot).not.toHaveBeenCalled();
    await act(() => result.current.chooseWorkspaceFolder('create'));
    await act(() => result.current.confirmWorkspaceAction());
    expect(options.onCreateWorkspaceRoot).toHaveBeenCalledWith(inspection.root);
    expect(options.onSwitchWorkspaceRoot).not.toHaveBeenCalled();
  });

  it('does nothing when the native folder picker is cancelled', async () => {
    vi.mocked(open).mockResolvedValue(null);
    const { result } = setup();
    await act(() => result.current.chooseWorkspaceFolder('switch'));
    expect(inspectWorkspacePath).not.toHaveBeenCalled();
    expect(result.current.pendingWorkspaceAction).toBeNull();
    expect(result.current.workspaceBusy).toBe(false);
  });

  it('rejects invalid directories and reports inspection failures without leaving busy state', async () => {
    vi.mocked(inspectWorkspacePath).mockResolvedValueOnce({ ...inspection, kind: 'not_workspace' });
    const { result, options } = setup();
    await act(() => result.current.chooseWorkspaceFolder('switch'));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(result.current.pendingWorkspaceAction).toBeNull();
    const error = new Error('unavailable');
    vi.mocked(inspectWorkspacePath).mockRejectedValueOnce(error);
    await act(() => result.current.chooseWorkspaceFolder('switch'));
    expect(options.onFailure).toHaveBeenCalledWith('检查工作区失败', error);
    expect(result.current.workspaceBusy).toBe(false);
  });

  it('retains confirmation for retry when unsaved-content protection rejects the switch', async () => {
    const { result, options } = setup();
    await act(() => result.current.inspectAndOpenRecentWorkspace(inspection.root));
    const error = new Error('save failed');
    options.onBeforeWorkspaceChange.mockRejectedValueOnce(error);
    await act(() => result.current.confirmWorkspaceAction());
    expect(options.onSwitchWorkspaceRoot).not.toHaveBeenCalled();
    expect(getWorkspaceSettings).not.toHaveBeenCalled();
    expect(options.onFailure).toHaveBeenCalledWith('工作区操作失败', error);
    expect(result.current.pendingWorkspaceAction?.intent).toBe('switch');
    expect(result.current.workspaceBusy).toBe(false);
    await act(() => result.current.confirmWorkspaceAction());
    expect(options.onSwitchWorkspaceRoot).toHaveBeenCalledOnce();
  });

  it('does not dismiss a confirmation while the workspace switch is in progress', async () => {
    const { result, options } = setup();
    await act(() => result.current.chooseWorkspaceFolder('switch'));
    let finish!: () => void;
    options.onSwitchWorkspaceRoot.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.confirmWorkspaceAction(); });
    expect(result.current.workspaceBusy).toBe(true);
    act(() => result.current.cancelWorkspaceAction());
    expect(result.current.pendingWorkspaceAction).not.toBeNull();
    await act(async () => { finish(); await pending; });
    expect(result.current.pendingWorkspaceAction).toBeNull();
  });

  it('does not turn a missing recent workspace into a new empty workspace', async () => {
    vi.mocked(inspectWorkspacePath).mockResolvedValue({ ...inspection, kind: 'empty_directory' });
    const { result, options } = setup();
    await act(() => result.current.inspectAndOpenRecentWorkspace(inspection.root));
    expect(result.current.pendingWorkspaceAction).toBeNull();
    expect(options.onCreateWorkspaceRoot).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: '无法打开最近工作区' }));
  });

  it('protects default-workspace changes and recovers from a failed reset', async () => {
    const { result, options } = setup();
    const error = new Error('reset failed');
    options.onResetWorkspaceRoot.mockRejectedValueOnce(error);
    await act(() => result.current.resetWorkspaceRoot());
    expect(options.onFailure).toHaveBeenCalledWith('打开默认工作区失败', error);
    expect(result.current.workspaceBusy).toBe(false);
    await act(() => result.current.resetWorkspaceRoot());
    expect(options.onBeforeWorkspaceChange).toHaveBeenCalledTimes(2);
    expect(options.onWorkspaceSettingsChanged).toHaveBeenCalledWith(settings);
  });
});
