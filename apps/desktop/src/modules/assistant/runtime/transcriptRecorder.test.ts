import { describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';
import { createTranscriptRecorder } from './transcriptRecorder';
import { DurableExecution } from './durableExecution';
import { RunBudget } from '../agent-core';

const model = { profileId: 'profile', model: 'model', protocol: 'openai_compatible' };
const initial: ModelMessage[] = [
  { role: 'user', content: 'OLD_HISTORY_MUST_NOT_BE_SAVED_AGAIN' }, { role: 'user', content: 'Current request' }
];
describe('per-run transcript recording', () => {
  it('persists a stable start on resume and captures only new messages', async () => {
    const record: AgentExecutionRecord = { id: 'execution-test', conversationId: 'conv', revision: 0,
      status: 'running', updatedAt: '', payload: {} };
    const sources = new Map([[1, { entry_id: 'entry', entry_title: 'Paper', segment_uid: 's', page_idx: 0, quote: 'New evidence' }]]);
    const execution = new DurableExecution('fixture', record, new RunBudget());
    const first = createTranscriptRecorder({ execution, model, initialMessageCount: 2, sources, firstNewMarker: 1 });
    const messages: ModelMessage[] = [...initial, { role: 'assistant', content: 'Result' }];
    execution.set('actor:main', { messages, turns: 1 });
    const restored = new DurableExecution('fixture', JSON.parse(JSON.stringify(record)), new RunBudget());
    const next = createTranscriptRecorder({ execution: restored, model, initialMessageCount: 999, sources, firstNewMarker: 1 });
    expect(next.startIndex).toBe(first.startIndex);
    await next.save({ messages, turns: 1 });
    expect(next.current?.runId).toBe('execution-test');
    expect(next.current?.messages).toEqual([{ role: 'assistant', content: 'Result' }]);
    expect(JSON.stringify(next.current)).not.toContain('OLD_HISTORY');
  });

  it('keeps draft callbacks unverified until final delivery and does not duplicate unchanged writes', async () => {
    const onTranscript = vi.fn();
    const recorder = createTranscriptRecorder({ model, initialMessageCount: 2, sources: new Map(), firstNewMarker: 1, onTranscript });
    const checkpoint = { messages: [...initial, { role: 'assistant' as const, content: 'Answer' }], turns: 1, answer: 'Answer' };
    await recorder.save(checkpoint);
    await recorder.save({ ...checkpoint, turns: 2 });
    expect(onTranscript).toHaveBeenCalledOnce();
    expect(onTranscript.mock.calls[0][0].outcome).toBe('running');
    await recorder.finish([]);
    expect(recorder.current?.outcome).toBe('completed');
    expect(onTranscript.mock.calls[1][0].outcome).toBe('running');
  });

  it('does not duplicate historical sources and snapshots data before late mutations', async () => {
    const old = { entry_id: 'entry', entry_title: 'Paper', segment_uid: 's0', page_idx: 0, quote: 'Old' };
    const fresh = { ...old, segment_uid: 's1', quote: 'Fresh' };
    const sources = new Map([[1, old], [2, fresh]]);
    const recorder = createTranscriptRecorder({ model, initialMessageCount: 2, sources, firstNewMarker: 2 });
    const messages: ModelMessage[] = [...initial, { role: 'assistant', content: 'Read [S2]' }];
    await recorder.save({ messages, turns: 1 });
    fresh.quote = 'late change';
    (messages[2] as { content: string }).content = 'late output';
    expect(recorder.current?.sources).toEqual([[2, { ...old, segment_uid: 's1', quote: 'Fresh' }]]);
    expect(recorder.current?.messages[0].content).toBe('Read [S2]');
  });

  it('refuses a corrupt saved start rather than including or dropping unrelated history', () => {
    const record: AgentExecutionRecord = { id: 'execution-test', conversationId: 'conv', revision: 0,
      status: 'running', updatedAt: '', payload: { 'transcriptStart:main': -1 } };
    expect(() => createTranscriptRecorder({ model, initialMessageCount: 2, sources: new Map(), firstNewMarker: 1,
      execution: new DurableExecution('fixture', record, new RunBudget()) })).toThrow('上下文起点无效');
  });
});
