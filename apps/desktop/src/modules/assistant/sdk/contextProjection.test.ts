import { summaryResponse } from './testHelpers/summary';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { createContextProjector, contextCut, type ProjectionState } from './contextProjection';
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
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(runTextModelTask).mockResolvedValue({ text: summaryResponse('Earlier findings [S1] and original goal.'), finishReason: 'stop' });
});

describe('automatic prefix compaction', () => {
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
  it('fails without dropping an oversized current message or a tool batch that cannot fit', async () => {
    await expect(createContextProjector(settings).project([{ role: 'user', content: 'x'.repeat(40_000) }], 5_000))
      .rejects.toMatchObject({ reason: 'context_capacity' });
    expect(runTextModelTask).not.toHaveBeenCalled();
  });
  it('discards retired projection formats and recomputes from the canonical transcript', async () => {
    const projector = createContextProjector(settings, undefined, { restored: { version: 2, firstKeptIndex: 3, memory: memory('OLD_BROKEN_STATE') } });
    const result = await projector.project(tools, 5_000);
    expect(projector.snapshot()?.version).toBe(3);
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
