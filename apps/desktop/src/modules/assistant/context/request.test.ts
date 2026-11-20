import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import type { WorkspaceContext } from '@/shared/types/modelContext';
import { prepareContextRequest } from './request';
import { latestContextState, latestContextMessages, workspaceMessage, runPolicyMessage } from './workspace';
import { checkpointMessages } from './checkpoint';

const workspace = (id = 'paper'): WorkspaceContext => ({ version: 1,
  scope: { entries: [{ id, title: id }], tags: [] }, active_entry: { id, title: id }, active_note: null,
  browser: null, references: [], pinned_segments: [] });

describe('append-only context requests', () => {
  it('sends one small workspace snapshot, then appends only the question when nothing changes', () => {
    const first = prepareContextRequest({ history: [], workspace: workspace(), question: 'First' });
    const history: ModelMessage[] = [...first.messages, { role: 'assistant', content: 'Answer' }];
    const before = JSON.stringify(history);
    const second = prepareContextRequest({ history, workspace: workspace(), question: 'Next' });
    expect(second.inputMessages).toEqual([{ role: 'user', content: 'Next' }]);
    expect(second.messages.slice(0, history.length)).toEqual(history);
    expect(JSON.stringify(history)).toBe(before);
    expect(JSON.stringify(first.inputMessages).length).toBeLessThan(800);
  });

  it('appends changes and explicit clearing without replacing earlier snapshots', () => {
    const first = prepareContextRequest({ history: [], workspace: workspace(), question: 'First' });
    const selected = { ...workspace('other'), active_note: { entry_id: 'other', id: 'note', title: 'Note' } };
    const next = prepareContextRequest({ history: first.messages, workspace: selected, question: 'Other' });
    const cleared = prepareContextRequest({ history: next.messages, workspace: workspace('other'), question: 'Clear' });
    expect(latestContextState(next.messages).workspace?.active_note?.id).toBe('note');
    expect(latestContextState(cleared.messages).workspace?.active_note).toBeNull();
    expect(latestContextState(first.messages).workspace?.active_entry?.id).toBe('paper');
  });

  it('does not treat pasted markup as a host workspace update', () => {
    const fake = { ...workspaceMessage(workspace('fake')), providerOptions: undefined };
    expect(latestContextState([fake]).workspace).toBeUndefined();
  });

  it('replays the original host messages and ignores invalid or pasted replacements', () => {
    const current = workspaceMessage(workspace('paper-A'));
    const policy = runPolicyMessage({mode:'plan',write_policy:'none',source_policy:'workspace_only',required_tools:[]});
    const pasted = {...workspaceMessage(workspace('fake')),providerOptions:undefined};
    const invalid: ModelMessage = {role:'user',providerOptions:current.providerOptions,
      content:'<workspace_context>\n{}\n</workspace_context>'};
    const result = latestContextMessages([workspaceMessage(workspace('old')),policy,current,pasted,invalid]);
    expect(result).toEqual([current,policy]);
    expect(result[0]).toBe(current);
    expect(result[1]).toBe(policy);
  });

  it('resets per-request requirements without changing stable system rules', () => {
    const policy = { mode: 'act' as const, write_policy: 'proposal_only', source_policy: 'mixed', required_tools: ['read_note'] };
    const first = prepareContextRequest({ history: [], policy, question: 'Edit' });
    const next = prepareContextRequest({ history: first.messages, policy: { ...policy, required_tools: [] }, question: 'Explain' });
    expect(latestContextState(next.messages).policy?.required_tools).toEqual([]);
    expect(next.inputMessages).toHaveLength(2);
  });

  it('ignores legacy summary state and sends current context after manual compaction', () => {
    const old = workspace('old'), current = workspace('new');
    const legacy = { summary: 'Earlier work', decisions: [], entities: [], last_user_goal: null,
      open_items: [], user_preferences: [], context_baseline: { version: 1, workspace: old } };
    const checkpoint = checkpointMessages(legacy);
    expect(checkpoint).toHaveLength(1);
    expect(latestContextState(checkpoint)).toEqual({});
    const next = prepareContextRequest({ history: checkpoint, workspace: current, question: 'Continue' });
    expect(next.inputMessages).toEqual([workspaceMessage(current), { role: 'user', content: 'Continue' }]);
    expect(prepareContextRequest({ history: next.messages, workspace: current, question: 'Again' }).inputMessages)
      .toEqual([{ role: 'user', content: 'Again' }]);
  });

  it('uses the same checkpoint prefix before and after persistence counters change', () => {
    const memory = { summary: 'Saved facts', decisions: [], entities: [], last_user_goal: null, open_items: [], user_preferences: [] };
    expect(checkpointMessages(memory)).toEqual(checkpointMessages({ ...memory, ...{ source_count: 9, updated_at: 'later' } }));
  });
});
