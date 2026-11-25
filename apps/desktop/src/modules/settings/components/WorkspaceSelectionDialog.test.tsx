// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingWorkspaceAction } from '../useWorkspaceSelection';
import { WorkspaceSelectionDialog } from './WorkspaceSelectionDialog';

const action: PendingWorkspaceAction = {
  intent: 'switch',
  inspection: {
    root: '\\\\?\\D:\\Library', kind: 'valid_workspace', entry_count: 7,
    trashed_entry_count: 0, message: ''
  }
};
afterEach(cleanup);

describe('workspace confirmation dialog', () => {
  it('displays the inspected workspace and cancels with Escape without switching', async () => {
    const confirm = vi.fn(async () => {});
    function Harness() {
      const [pending, setPending] = useState<PendingWorkspaceAction | null>(action);
      return <WorkspaceSelectionDialog pendingWorkspaceAction={pending} workspaceBusy={false}
        onCancel={() => setPending(null)} onConfirm={confirm} />;
    }
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: '切换工作区' })).toBeTruthy();
    expect(screen.getByText('D:\\Library')).toBeTruthy();
    expect(screen.getByText('将打开包含 7 个条目的工作区。')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps both actions disabled and ignores Escape during a pending workspace change', () => {
    const cancel = vi.fn();
    const confirm = vi.fn(async () => {});
    render(<WorkspaceSelectionDialog pendingWorkspaceAction={action} workspaceBusy
      onCancel={cancel} onConfirm={confirm} />);
    expect(screen.getByRole('button', { name: '取消' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '处理中…' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('only requests creation when the user confirms the empty-directory proposal', () => {
    const confirm = vi.fn(async () => {});
    const { rerender } = render(<WorkspaceSelectionDialog pendingWorkspaceAction={null}
      workspaceBusy={false} onCancel={vi.fn()} onConfirm={confirm} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<WorkspaceSelectionDialog pendingWorkspaceAction={{ ...action, intent: 'create' }}
      workspaceBusy={false} onCancel={vi.fn()} onConfirm={confirm} />);
    expect(screen.getByRole('dialog', { name: '新建工作区' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '新建并打开' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
