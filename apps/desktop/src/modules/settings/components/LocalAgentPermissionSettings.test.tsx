// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLocalAgentPermission, hasLocalAgentPermission } from '@/shared/lib/localAgentPermissions';
import { LocalAgentPermissionSettings } from './LocalAgentPermissionSettings';

const claude = { provider: 'claude', toolName: 'Bash' } as const;
const codex = { provider: 'codex', toolName: 'Edit' } as const;
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local agent permission settings', () => {
  it('displays persisted permissions after remount and revokes one or all within this workspace', () => {
    allowLocalAgentPermission('C:/Library', claude);
    allowLocalAgentPermission('C:/Library', codex);
    allowLocalAgentPermission('C:/Other', claude);
    const initial = render(<LocalAgentPermissionSettings root="C:/Library" />);
    initial.unmount();
    render(<LocalAgentPermissionSettings root={'c:\\Library\\'} />);
    expect(screen.getByText('Claude Code · 执行本地命令')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销 Claude Code 的执行本地命令授权' }));
    expect(hasLocalAgentPermission('C:/Library', claude)).toBe(false);
    expect(hasLocalAgentPermission('C:/Library', codex)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '全部恢复询问' }));
    expect(hasLocalAgentPermission('C:/Library', codex)).toBe(false);
    expect(hasLocalAgentPermission('C:/Other', claude)).toBe(true);
    expect(screen.getByText(/尚未设置/)).toBeTruthy();
  });
  it('updates from a conversation grant, a workspace switch and a storage event from another window', () => {
    const view = render(<LocalAgentPermissionSettings root="C:/Library" />);
    act(() => allowLocalAgentPermission('C:/Library', claude));
    expect(screen.getByText('Claude Code · 执行本地命令')).toBeTruthy();
    view.rerender(<LocalAgentPermissionSettings root="C:/Other" />);
    expect(screen.queryByText('Claude Code · 执行本地命令')).toBeNull();
    view.rerender(<LocalAgentPermissionSettings root="C:/Library" />);
    act(() => { localStorage.removeItem('neuink.localAgent.permissions.v1'); window.dispatchEvent(new StorageEvent('storage', { key: 'neuink.localAgent.permissions.v1' })); });
    expect(screen.queryByText('Claude Code · 执行本地命令')).toBeNull();
  });
  it('retains the grant and displays a safe error when revocation cannot be saved', () => {
    allowLocalAgentPermission('root', claude);
    render(<LocalAgentPermissionSettings root="root" />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-path'); });
    fireEvent.click(screen.getByRole('button', { name: '全部恢复询问' }));
    expect(screen.getByRole('alert').textContent).toContain('原授权仍然有效');
    expect(hasLocalAgentPermission('root', claude)).toBe(true);
  });
  it('provides empty and unavailable-workspace states without enabling grants', () => {
    const view = render(<LocalAgentPermissionSettings />);
    expect(screen.getByText('打开资料库后可管理授权。')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<LocalAgentPermissionSettings root="root" />);
    expect(screen.getByText(/尚未设置/)).toBeTruthy();
    act(() => { localStorage.setItem('neuink.localAgent.permissions.v1', 'invalid'); window.dispatchEvent(new StorageEvent('storage', { key: 'neuink.localAgent.permissions.v1' })); });
    expect(screen.getByRole('alert').textContent).toContain('逐次确认');
  });
});
