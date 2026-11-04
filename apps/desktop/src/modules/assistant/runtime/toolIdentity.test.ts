import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import type { AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import { RunBudget } from '../agent-core';
import { bindExecutionIdentity, DurableExecution } from './durableExecution';

vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn() }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

const boundary = (ids: string[], rationale = 'Keep note_propose_patch in free text') =>
  '<capability_boundary>\nApplication capability boundary (not a mandatory task plan):\n'
  + JSON.stringify({ enabledToolIds: ids, requiredToolIds: ids, rationale }) + '\n</capability_boundary>';
const oldIdentity = () => ({ model: 'model', endpoint: 'https://example.com', protocol: 'openai',
  agent: { ...DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant, enabledToolIds: ['read_note', 'note.propose_patch'] },
  tools: ['read_note', 'note_propose_patch'], system: ['Use note_propose_patch.', '', boundary(['read_note', 'note.propose_patch'])] });
const currentIdentity = () => ({ ...oldIdentity(),
  agent: { ...oldIdentity().agent, enabledToolIds: ['read_note', 'note_propose_patch'] },
  system: ['Use note_propose_patch.', '', boundary(['read_note', 'note_propose_patch'])] });

async function oldExecution(identity: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  const digest = [...new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const record: AgentExecutionRecord = { id: 'execution', conversationId: 'conversation', revision: 0,
    status: 'running', updatedAt: '', payload: { 'identity:main': digest } };
  return new DurableExecution('root', record, new RunBudget());
}

describe('tool name migration in execution identities', () => {
  it('resumes old tasks, then persists the canonical digest', async () => {
    const execution = await oldExecution(oldIdentity());
    const before = execution.get('identity:main');
    await bindExecutionIdentity(execution, 'main', currentIdentity());
    expect(execution.get('identity:main')).not.toBe(before);
    await expect(bindExecutionIdentity(execution, 'main', currentIdentity())).resolves.toBeUndefined();
  });

  it('supports local-agent identities that do not contain system prompts', async () => {
    const { agent, tools } = oldIdentity();
    const execution = await oldExecution({ provider: 'codex', agent, tools, mode: 'act' });
    await expect(bindExecutionIdentity(execution, 'main', {
      provider: 'codex', agent: currentIdentity().agent, tools, mode: 'act'
    })).resolves.toBeUndefined();
  });

  it.each(['model', 'permissions', 'tools', 'prompt', 'rationale'] as const)(
    'still rejects a changed %s instead of treating it as a rename', async field => {
      const execution = await oldExecution(oldIdentity());
      const identity = currentIdentity();
      if (field === 'model') identity.model = 'different';
      if (field === 'permissions') identity.agent.permissions = { ...identity.agent.permissions, canWriteProposals: false };
      if (field === 'tools') identity.tools.push('create_entry');
      if (field === 'prompt') identity.system[0] = 'Use note.propose_patch.';
      if (field === 'rationale') identity.system[2] = boundary(['read_note', 'note_propose_patch'], 'Different rationale');
      const before = execution.get('identity:main');
      await expect(bindExecutionIdentity(execution, 'main', identity)).rejects.toThrow('权限配置已改变');
      expect(execution.get('identity:main')).toBe(before);
    }
  );
});
