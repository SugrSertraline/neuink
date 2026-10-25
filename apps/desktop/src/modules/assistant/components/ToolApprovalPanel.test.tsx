// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalPanel } from './ToolApprovalPanel';
import { decideToolApproval, getToolApprovals, requestToolApproval } from '../runtime/toolApproval';
import { hasLocalAgentPermission } from '@/shared/lib/localAgentPermissions';

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); cleanup(); getToolApprovals().forEach(item => decideToolApproval(item.id, false)); });

describe('confirmation UI and run-owned lifetime', () => {
  it('explains the scope and persists only an explicit always-allow click', async () => {
    const pending = requestToolApproval('root', 'chat')({ toolName: 'codex.Bash', toolCallId: 'native', input: { command: 'echo example' } });
    const view = render(<ToolApprovalPanel root="root" conversationId="chat" onOpen={vi.fn()} />);
    expect(view.getByText(/包含此类操作的不同命令或文件/)).toBeTruthy();
    expect(view.getByRole('button', { name: '仅允许本次' })).toBeTruthy();
    const button = view.getByRole('button', { name: '以后都允许' });
    button.focus(); expect(document.activeElement).toBe(button);
    fireEvent.click(button); fireEvent.click(button);
    expect(await pending).toBe(true);
    expect(hasLocalAgentPermission('root', { provider: 'codex', toolName: 'Bash' })).toBe(true);
    expect(view.queryByRole('button', { name: '以后都允许' })).toBeNull();
  });
  it('shows a save error without approving and allows a single-call fallback', async () => {
    const pending = requestToolApproval('root', 'chat')({ toolName: 'claude.Bash', toolCallId: 'native', input: {} });
    const view = render(<ToolApprovalPanel root="root" conversationId="chat" onOpen={vi.fn()} />);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private-error'); });
    fireEvent.click(view.getByRole('button', { name: '以后都允许' }));
    expect(view.getByRole('alert').textContent).toContain('本次尚未执行');
    expect(view.queryByText('private-error')).toBeNull();
    expect(getToolApprovals()).toHaveLength(1);
    fireEvent.click(view.getByRole('button', { name: '仅允许本次' }));
    expect(await pending).toBe(true);
    expect(hasLocalAgentPermission('root', { provider: 'claude', toolName: 'Bash' })).toBe(false);
  });
  it('shows native command parameters directly and supports keyboard confirmation', async () => {
    const pending = requestToolApproval('root','chat')({toolName:'claude.Bash',toolCallId:'native',input:{command:'echo example'}});
    const view = render(<ToolApprovalPanel root="root" conversationId="chat" onOpen={vi.fn()} />);
    expect(view.getByText(/echo example/)).toBeTruthy();
    expect(view.container.querySelector('details')).toBeNull();
    const button = view.getByRole('button',{name:'拒绝并停止'}); button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button); expect(await pending).toBe(false);
  });
  it('shows exactly what will change and resolves a double click only once', async () => {
    const pending = requestToolApproval('root', 'chat')({ toolName: 'create_entry', toolCallId: '1', input: { title: '新论文' } });
    const view = render(<ToolApprovalPanel root="root" conversationId="chat" onOpen={vi.fn()} />);
    expect(view.getByText('新论文')).toBeTruthy();
    expect(view.queryByRole('button', { name: '以后都允许' })).toBeNull();
    const button = view.getByRole('button', { name: '确认执行' });
    fireEvent.click(button); fireEvent.click(button);
    expect(await pending).toBe(true);
    expect(view.queryByRole('button', { name: '确认执行' })).toBeNull();
  });
  it('switching conversations only offers navigation, never consent for a hidden task', async () => {
    const pending = requestToolApproval('root', 'original')({ toolName: 'app_set_appearance', toolCallId: '1', input: { appearance: 'atelier' } });
    const open = vi.fn();
    const view = render(<ToolApprovalPanel root="root" conversationId="new-chat" onOpen={open} />);
    expect(view.queryByText('确认执行')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '另一个对话等待确认，点击查看' }));
    expect(open).toHaveBeenCalledWith('original');
    view.rerender(<ToolApprovalPanel root="root" conversationId="original" onOpen={open} />);
    expect(view.getByText('工作室')).toBeTruthy();
    fireEvent.click(view.getByText('拒绝并停止'));
    expect(await pending).toBe(false);
  });
  it('stopping removes the request, so an old button cannot approve it', async () => {
    const abort = new AbortController();
    const pending = requestToolApproval('root', 'chat')({ toolName: 'mcp_server_write', toolCallId: '1', input: { text: 'Payload' } }, abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    const id = getToolApprovals()[0].id;
    const view = render(<ToolApprovalPanel root="root" conversationId="chat" onOpen={vi.fn()} />);
    expect(view.getByText('查看完整参数')).toBeTruthy();
    act(() => abort.abort());
    decideToolApproval(id, true);
    await rejected;
    expect(view.queryByText('确认执行')).toBeNull();
  });
  it('unmounting does not stop a background task, and another workspace cannot approve it', async () => {
    const pending = requestToolApproval('root', 'chat')({ toolName: 'create_entry', toolCallId: '1', input: { title: 'Title' } });
    const view = render(<ToolApprovalPanel root="different-root" conversationId="chat" onOpen={vi.fn()} />);
    expect(view.queryByText('确认执行')).toBeNull();
    view.unmount();
    expect(getToolApprovals()).toHaveLength(1);
    decideToolApproval(getToolApprovals()[0].id, false);
    expect(await pending).toBe(false);
  });
});
