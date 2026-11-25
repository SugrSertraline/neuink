import { summaryResponse } from './testHelpers/summary';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { createContextProjector, contextCut, projectionRetainedMessages, type ProjectionState } from './contextProjection';
import { latestContextState, latestContextMessages, workspaceMessage, runPolicyMessage } from '../context/workspace';
import { renderConversationContext } from '../runtime/conversationTranscript';
import type { AssistantConversationMemory, ConversationMessage } from '@/shared/ipc/assistantApi';
import type { WorkspaceContext } from '@/shared/types/modelContext';
import { runTextModelTask } from './modelTasks';
import { AgentLocalLimitError, AgentStoppedError, RunBudget } from '../agent-core';
import { estimateMessagesTokens } from './contextUsage';
vi.mock('./modelTasks', () => ({ runTextModelTask: vi.fn() }));

const settings = { max_context_length: 8_000 } as LlmProfile;
const memory = (summary = 'Earlier knowledge.') => ({
  decisions: ['Earlier decision'], entities: [], last_user_goal: 'Keep the original goal',
  open_items: ['Unresolved question'], summary, user_preferences: ['Use Chinese']
});
const history: ModelMessage[] = [
  { role: 'user', content: 'EARLIEST_REQUEST_SENTINEL' },
  ...Array.from({ length: 39 }, (_, index) => ({
    role: index % 2 ? 'user' as const : 'assistant' as const,
    content: 'turn-' + index + ' ' + 'a'.repeat(1_000)
  })),
  { role: 'user', content: 'LATEST_REQUEST_SENTINEL' }
];
const tools: ModelMessage[] = [
  { role: 'user', content: 'EXACT_CURRENT_GOAL' },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'read', input: {} }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'read', output: { type: 'text', value: 'EARLY_TOOL_RESULT [S1] '.repeat(2_000) } }] },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'b', toolName: 'read', input: {} }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'b', toolName: 'read', output: { type: 'text', value: 'LATEST_TOOL_RESULT [S2]' } }] }
];
const workspace = (id: string): WorkspaceContext => ({version:1,scope:{entries:[{id,title:id}],tags:[]},
  active_entry:{id,title:id},active_note:null,browser:null,references:[],pinned_segments:[]});
const policy = {mode:'act' as const,write_policy:'proposal_only',source_policy:'mixed',required_tools:[]};
function readBatch(id: string): ModelMessage[] {
  return [{role:'assistant',content:[{type:'tool-call',toolCallId:id,toolName:'read',input:{}}]},
    {role:'tool',content:[{type:'tool-result',toolCallId:id,toolName:'read',output:{type:'text',value:'Read result '+id}}]}];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runTextModelTask).mockResolvedValue({ text: summaryResponse('Earlier findings [S1] and original goal.'), finishReason: 'stop' });
});

describe('automatic prefix compaction', () => {
  it('replays frozen context after recent history and preserves it across persistence', async () => {
    const old = workspaceMessage(workspace('old'));
    const frozen = workspace('paper-A');
    const current = workspaceMessage(frozen);
    const messages: ModelMessage[] = [old, current, runPolicyMessage(policy), ...history];
    const original = JSON.stringify(messages);
    // A later UI change must not retarget the submitted request or regenerate its host messages.
    frozen.active_entry = {id:'paper-B',title:'paper-B'};
    const projector = createContextProjector(settings);
    const projected = await projector.project(messages, 0);
    const saved = projector.snapshot()!;
    expect(saved.version).toBe(5);
    expect(saved.contextRefreshIndex).toBe(messages.length);
    expect(saved).not.toHaveProperty('baseline');
    expect(projected.slice(-2)).toEqual([current, runPolicyMessage(policy)]);
    expect(latestContextState(projected)).toEqual({workspace:workspace('paper-A'),policy});
    expect(JSON.stringify(projected)).not.toContain('paper-B');
    expect(JSON.stringify(messages)).toBe(original);
    const profile = { profileId: 'profile', model: 'model', protocol: 'openai_compatible' };
    const checkpoint: AssistantConversationMemory = { ...saved.memory,
      observed_markers: saved.markers, message_count: 42, pending_proposal_count: 0, source_count: 0, updated_at: 'later',
      retained_context: { version: 2, ...profile, messages: projectionRetainedMessages(saved, messages) } };
    const disk: ConversationMessage[] = JSON.parse(JSON.stringify([{ message_id: 'checkpoint', role: 'assistant', content: '',
      created_at: '', source_links: [], parts: [{ type: 'memory', memory: checkpoint }] }]));
    expect(renderConversationContext(disk, profile)).toEqual(projected);
    expect(JSON.stringify(checkpoint)).not.toContain('context_baseline');
  });

  it('keeps the refresh at the same position while complete tool batches are appended', async () => {
    const messages: ModelMessage[] = [workspaceMessage(workspace('paper-A')), runPolicyMessage(policy), ...history];
    const projector = createContextProjector(settings);
    let previous = await projector.project(messages, 0);
    const index = projector.snapshot()!.contextRefreshIndex;
    const summaries = vi.mocked(runTextModelTask).mock.calls.length;
    for (const id of ['one','two']) {
      messages.push(...readBatch(id));
      const next = await projector.project(messages, 0);
      expect(next.slice(0,previous.length)).toEqual(previous);
      expect(next.slice(previous.length)).toEqual(readBatch(id));
      expect(next.filter(message=>message.providerOptions?.neuink?.context === 'workspace_context')).toHaveLength(1);
      expect(projector.snapshot()!.contextRefreshIndex).toBe(index);
      previous = next;
    }
    const restored = createContextProjector(settings, undefined, {restored:JSON.parse(JSON.stringify(projector.snapshot()))});
    expect(await restored.project(messages,0)).toEqual(previous);
    expect(runTextModelTask).toHaveBeenCalledTimes(summaries);
  });

  it('replays explicit clearing after retained older state and publishes a new refresh on another compaction', async () => {
    const cleared: WorkspaceContext = {...workspace('paper-A'),active_entry:null,scope:{entries:[],tags:[]}};
    const messages: ModelMessage[] = [workspaceMessage(workspace('old')), ...history,
      workspaceMessage(cleared), runPolicyMessage({...policy,mode:'plan'}), {role:'user',content:'Current request'}];
    const projector = createContextProjector(settings);
    const first = await projector.project(messages,0);
    const oldCut = projector.snapshot()!.firstKeptIndex;
    expect(latestContextState(first)).toEqual({workspace:cleared,policy:{...policy,mode:'plan'}});
    messages.push(...Array.from({length:35},(_,i):ModelMessage=>({role:i%2?'assistant':'user',content:'growth '+ 'a'.repeat(1000)})));
    const second = await projector.project(messages,0);
    expect(projector.snapshot()!.firstKeptIndex).toBeGreaterThan(oldCut);
    expect(projector.snapshot()!.contextRefreshIndex).toBe(messages.length);
    expect(second.slice(-2)).toEqual([workspaceMessage(cleared),runPolicyMessage({...policy,mode:'plan'})]);
    expect(second.filter(message=>message.providerOptions?.neuink?.context === 'workspace_context')).toHaveLength(1);
    const grown = [...messages,...readBatch('after-second')];
    expect((await projector.project(grown,0)).slice(0,second.length)).toEqual(second);
  });

  it('ignores invalid v5 refresh positions, including positions splitting a tool batch', async () => {
    const messages: ModelMessage[] = [workspaceMessage(workspace('paper-A')),...history,...readBatch('last')];
    const first = createContextProjector(settings);
    await first.project(messages,0);
    const saved = first.snapshot()!;
    for (const index of [-1,saved.firstKeptIndex-1,messages.length+1,messages.length-1,undefined]) {
      const count = vi.mocked(runTextModelTask).mock.calls.length;
      const restored = createContextProjector(settings,undefined,{restored:{...saved,contextRefreshIndex:index}});
      await restored.project(messages,0);
      expect(restored.snapshot()!.contextRefreshIndex).toBe(messages.length);
      expect(vi.mocked(runTextModelTask).mock.calls.length).toBeGreaterThan(count);
    }
  });

  it('does not invent workspace messages for a transcript without host context', async () => {
    expect(latestContextMessages(await createContextProjector(settings).project(history,0))).toEqual([]);
  });

  it('includes replayed workspace size in the capacity check before publishing a checkpoint', async () => {
    const large = {...workspace('paper-A'),active_entry:{id:'paper-A',title:'x'.repeat(30000)}};
    const states: ProjectionState[] = [];
    const projector = createContextProjector(settings,undefined,{onState:value=>states.push(value)});
    await expect(projector.project([workspaceMessage(large),...history],0)).rejects.toMatchObject({reason:'context_capacity'});
    expect(runTextModelTask).toHaveBeenCalled();
    expect(projector.snapshot()).toBeUndefined();
    expect(states).toEqual([]);
  });
  it('selects the newest suffix backwards instead of scanning forwards or double-counting the latest message', () => {
    const messages: ModelMessage[] = Array.from({ length: 6 }, () => ({ role: 'user', content: 'a'.repeat(2_000) }));
    expect(contextCut(messages, 1_010)).toBe(4);
  });
  it('preserves the newest complete tool batch and exact current goal without mutating canonical messages', async () => {
    const before = JSON.stringify(tools);
    const result = await createContextProjector(settings, undefined, { requestIndex: 0 }).project(tools, 5_000);
    expect(result.slice(-2)).toEqual(tools.slice(-2));
    expect(JSON.stringify(result)).toContain('EXACT_CURRENT_GOAL');
    expect(JSON.stringify(result)).toContain('[S1]');
    expect(JSON.stringify(tools)).toBe(before);
    const supplied = vi.mocked(runTextModelTask).mock.calls.map(([call]) => call.prompt).join('\n');
    expect(supplied).toContain('EARLY_TOOL_RESULT');
  });
  it('passes the existing checkpoint and every dropped turn to the summarizer', async () => {
    let state: ProjectionState | undefined;
    const messages: ModelMessage[] = [{ role: 'user', content: 'Existing memory placeholder' }, ...history];
    const result = await createContextProjector(settings, undefined, {
      initialMemory: memory('PERSIST_OLD_MEMORY_SENTINEL'), requestIndex: messages.length - 1,
      onState: value => { state = value; }
    }).project(messages, 5_000);
    const supplied = vi.mocked(runTextModelTask).mock.calls.map(([call]) => call.prompt).join('\n');
    expect(supplied).toContain('PERSIST_OLD_MEMORY_SENTINEL');
    expect(supplied).toContain('Use Chinese');
    expect(supplied).toContain('EARLIEST_REQUEST_SENTINEL');
    expect(supplied).not.toContain('LATEST_REQUEST_SENTINEL');
    for (const message of messages.slice(1, state!.firstKeptIndex)) {
      if (typeof message.content === 'string') expect(supplied).toContain(message.content.split(' ')[0]);
    }
    expect(JSON.stringify(result)).toContain('LATEST_REQUEST_SENTINEL');
  });
  it('does not recount already compacted original messages when provider usage is absent', async () => {
    const projector = createContextProjector(settings);
    await projector.project(tools, 5_000);
    const count = vi.mocked(runTextModelTask).mock.calls.length;
    projector.recordUsage(undefined, tools.length);
    const grown: ModelMessage[] = [...tools,
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c', toolName: 'read', output: { type: 'text', value: 'more '.repeat(700) } }] }
    ];
    const projected = await projector.project(grown, 5_000);
    expect(estimateMessagesTokens(projected)).toBeLessThan(7_200);
    expect(runTextModelTask).toHaveBeenCalledTimes(count);
  });
  it('restores the same boundary and recent messages without purchasing another summary', async () => {
    const first = createContextProjector(settings, undefined, { requestIndex: 0 });
    const projected = await first.project(tools, 5_000);
    const count = vi.mocked(runTextModelTask).mock.calls.length;
    const again = await createContextProjector(settings, undefined, {
      restored: JSON.parse(JSON.stringify(first.snapshot())), requestIndex: 0
    }).project(tools, 5_000);
    expect(again).toEqual(projected);
    expect(runTextModelTask).toHaveBeenCalledTimes(count);
  });
  it('never replaces old memory with a raw-tail fallback when summarization is unavailable', async () => {
    const projector = createContextProjector(settings, undefined, { initialMemory: memory('keep me') });
    await expect(projector.project(history, 5_000, undefined, false)).rejects.toBeInstanceOf(AgentLocalLimitError);
    expect(projector.snapshot()).toBeUndefined();
    expect(runTextModelTask).not.toHaveBeenCalled();
  });
  it('can compact on the final synthesis turn without consuming a task turn', async () => {
    const budget = new RunBudget(1);
    budget.turns = 1;
    await createContextProjector(settings, budget).project(tools, 5_000);
    expect(runTextModelTask).toHaveBeenCalled();
    expect(vi.mocked(runTextModelTask).mock.calls.every(([call]) => call.chargeTurn === false)).toBe(true);
    expect(budget.turns).toBe(1);
  });
  it('publishes nothing if any summary chunk is invalid or cancelled', async () => {
    const states: ProjectionState[] = [];
    vi.mocked(runTextModelTask).mockResolvedValue({ text: 'incomplete', finishReason: 'length' });
    await expect(createContextProjector(settings, undefined, { onState: state => states.push(state) })
      .project(tools, 5_000)).rejects.toBeInstanceOf(AgentStoppedError);
    expect(states).toEqual([]);
  });
  it.each(['invalid','cancelled','capacity'] as const)('keeps an existing checkpoint when the next compaction is %s', async failure => {
    const messages: ModelMessage[] = [workspaceMessage(workspace('paper-A')),...history];
    const projector = createContextProjector(settings);
    await projector.project(messages,0);
    const saved = JSON.stringify(projector.snapshot());
    const controller = new AbortController();
    const grown: ModelMessage[] = [...messages,...Array.from({length:35},(_,i):ModelMessage=>({role:i%2?'assistant':'user',content:'a'.repeat(1000)}))];
    if (failure === 'invalid') vi.mocked(runTextModelTask).mockResolvedValue({text:'invalid',finishReason:'length'});
    if (failure === 'cancelled') vi.mocked(runTextModelTask).mockImplementation(async () => {
      controller.abort(new DOMException('Cancelled','AbortError'));
      return {text:summaryResponse('Valid summary'),finishReason:'stop'};
    });
    if (failure === 'capacity') grown.push({role:'user',content:'z'.repeat(40000)});
    await expect(projector.project(grown,0,controller.signal)).rejects.toThrow();
    expect(JSON.stringify(projector.snapshot())).toBe(saved);
  });
  it('fails without dropping an oversized current message or a tool batch that cannot fit', async () => {
    await expect(createContextProjector(settings).project([{ role: 'user', content: 'x'.repeat(40_000) }], 5_000))
      .rejects.toMatchObject({ reason: 'context_capacity' });
    expect(runTextModelTask).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3, 4])('discards retired v%s projections and recomputes from current messages', async version => {
    const projector = createContextProjector(settings, undefined, { restored: { version, firstKeptIndex: 3, memory: memory('OLD_BROKEN_STATE') } });
    const result = await projector.project(tools, 5_000);
    expect(projector.snapshot()?.version).toBe(5);
    expect(JSON.stringify(result)).not.toContain('OLD_BROKEN_STATE');
    expect(runTextModelTask).toHaveBeenCalled();
  });
});

describe('provider usage calibration', () => {
  it('uses reported usage and calibrated growth rather than an intentionally high character estimate', async () => {
    const projector = createContextProjector(settings);
    const baseline: ModelMessage[] = [{ role: 'user', content: 'a'.repeat(400) }];
    await projector.project(baseline, 5_000, undefined, true, 100);
    projector.recordUsage(100, baseline.length);
    const grown: ModelMessage[] = [...baseline, { role: 'user', content: '中'.repeat(7_000) }];
    await projector.project(grown, 5_000, undefined, true, 100);
    expect(runTextModelTask).not.toHaveBeenCalled();
  });
  it('compacts when actual input usage crosses the threshold', async () => {
    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: 'a'.repeat(1_500)
    }));
    const projector = createContextProjector(settings);
    await projector.project(messages, 5_000);
    projector.recordUsage(7_300, messages.length);
    await projector.project(messages, 5_000);
    expect(runTextModelTask).toHaveBeenCalled();
  });
});
