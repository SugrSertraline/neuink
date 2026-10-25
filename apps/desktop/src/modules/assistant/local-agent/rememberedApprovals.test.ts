// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLocalAgentPermission, hasLocalAgentPermission, revokeLocalAgentPermission } from '@/shared/lib/localAgentPermissions';
import { approveClaudeTool } from './approvals';
import { decideToolApproval, getToolApprovals, requestToolApproval } from '../runtime/toolApproval';
import type { RunAssistantHarnessOptions } from '../harness/engine';

const root = 'C:/Library';
const options = (workspace = root, extra: Partial<RunAssistantHarnessOptions> = {}) => ({
  root: workspace, requestToolApproval: requestToolApproval(workspace, 'chat'), ...extra,
}) as RunAssistantHarnessOptions;
const command = { tool_name: 'Bash', input: { command: 'echo synthetic' } };
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); getToolApprovals().forEach(item => decideToolApproval(item.id, false)); });

describe('remembered local agent approvals', () => {
  it.each(['claude', 'codex', 'opencode'] as const)('%s remembers explicit consent across conversations and checks revocation per call', async provider => {
    const first = approveClaudeTool(command, 'first', options(), provider);
    expect(getToolApprovals()).toHaveLength(1);
    decideToolApproval(getToolApprovals()[0].id, 'always');
    expect(await first).toMatchObject({ behavior: 'allow' });
    expect(hasLocalAgentPermission(root, { provider, toolName: 'Bash' })).toBe(true);
    const next = await approveClaudeTool({ ...command, input: { command: 'echo another-synthetic' } }, 'next',
      options('c:\\Library\\', { requestToolApproval: requestToolApproval('c:\\Library\\', 'another-chat') }), provider);
    expect(next).toMatchObject({ behavior: 'allow', updatedInput: { command: 'echo another-synthetic' } });
    expect(getToolApprovals()).toHaveLength(0);
    revokeLocalAgentPermission(root, { provider, toolName: 'Bash' });
    const again = approveClaudeTool(command, 'again', options(), provider);
    expect(getToolApprovals()).toHaveLength(1);
    decideToolApproval(getToolApprovals()[0].id, false);
    expect(await again).toMatchObject({ behavior: 'deny' });
  });

  it('does not remember a single approval and never carries a grant across providers, tools or workspaces', async () => {
    const once = approveClaudeTool(command, 'once', options());
    decideToolApproval(getToolApprovals()[0].id, true);
    expect(await once).toMatchObject({ behavior: 'allow' });
    expect(hasLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' })).toBe(false);
    allowLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' });
    for (const [provider, tool, workspace] of [
      ['codex', 'Bash', root], ['claude', 'Read', root], ['claude', 'Bash', 'C:/Other'],
    ] as const) {
      const pending = approveClaudeTool({ tool_name: tool, input: {} }, tool, options(workspace), provider);
      expect(getToolApprovals()).toHaveLength(1);
      decideToolApproval(getToolApprovals()[0].id, false);
      expect(await pending).toMatchObject({ behavior: 'deny' });
    }
    const host = requestToolApproval(root, 'chat')({ toolCallId: 'host', toolName: 'create_entry', input: {} });
    expect(() => decideToolApproval(getToolApprovals()[0].id, 'always')).toThrow('不支持');
    decideToolApproval(getToolApprovals()[0].id, false);
    expect(await host).toBe(false);
  });

  it('still protects library writes and user questions after a native grant', async () => {
    allowLocalAgentPermission(root, { provider: 'claude', toolName: 'Edit' });
    expect(await approveClaudeTool({ tool_name: 'Edit', input: { file_path: 'C:/Library/notes/a.md' } }, 'write', options()))
      .toMatchObject({ behavior: 'deny' });
    expect(() => allowLocalAgentPermission(root, { provider: 'claude', toolName: 'AskUserQuestion' })).toThrow();
    expect(getToolApprovals()).toHaveLength(0);
  });

  it('keeps the request pending if persistence fails and permits retrying only this call', async () => {
    const pending = approveClaudeTool(command, 'failure', options());
    const id = getToolApprovals()[0].id;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => decideToolApproval(id, 'always')).toThrow();
    expect(getToolApprovals()).toHaveLength(1);
    expect(hasLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' })).toBe(false);
    decideToolApproval(id, true);
    expect(await pending).toMatchObject({ behavior: 'allow' });
  });

  it('does not create a grant from a cancelled request or bypass cancellation with a saved grant', async () => {
    const abort = new AbortController();
    const pending = approveClaudeTool(command, 'stopped', options(root, { abortSignal: abort.signal }));
    const rejected = expect(pending).rejects.toThrow();
    const id = getToolApprovals()[0].id;
    abort.abort();
    decideToolApproval(id, 'always');
    await rejected;
    expect(hasLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' })).toBe(false);
    allowLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' });
    await expect(approveClaudeTool(command, 'stopped-again', options(root, { abortSignal: abort.signal }))).rejects.toThrow();
  });

  it('fails closed on invalid stored data or storage access errors', async () => {
    const key = 'neuink.localAgent.permissions.v1';
    for (const value of ['broken', JSON.stringify({ version: 2, grants: [] }),
      JSON.stringify({ version: 1, grants: [{ root, provider: 'claude', toolName: 'AskUserQuestion' }] }),
      JSON.stringify({ version: 1, grants: [{ root, provider: 'claude.Bash', toolName: 'Read' }] })]) {
      localStorage.setItem(key, value);
      expect(hasLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' })).toBe(false);
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(hasLocalAgentPermission(root, { provider: 'claude', toolName: 'Bash' })).toBe(false);
  });
});
