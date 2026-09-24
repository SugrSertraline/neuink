import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { contextCut, createContextProjector } from './contextProjection';
import { runJsonModelTask } from './modelTasks';
vi.mock('./modelTasks', () => ({ runJsonModelTask: vi.fn(async () => ({ summary: 'Read source [S1], no writes applied.' })) }));
const messages: ModelMessage[] = [
  { role: 'user', content: 'Compare the papers and preserve citations.' },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: {} }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: { type: 'text', value: 'Evidence [S1] '.repeat(1200) } }] },
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c2', toolName: 'read', input: {} }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c2', toolName: 'read', output: { type: 'text', value: 'Recent evidence [S2]' } }] }
];
beforeEach(() => vi.clearAllMocks());
describe('context projection', () => {
  it('retains tool-call/result pairs and never mutates canonical evidence', async () => {
    const before = JSON.stringify(messages);
    expect(contextCut(messages, 5000)).toBe(3);
    const project = createContextProjector({} as LlmProfile);
    const projected = await project(messages, 5000);
    expect(projected.slice(-2)).toEqual(messages.slice(-2));
    expect(JSON.stringify(projected)).toContain('[S1]');
    expect(JSON.stringify(messages)).toBe(before);
    await project(messages, 5000);
    expect(runJsonModelTask).toHaveBeenCalledOnce();
  });
  it('fails without deleting an oversized initial request or incomplete tool batch', async () => {
    const project = createContextProjector({} as LlmProfile);
    await expect(project([{ role: 'user', content: 'x'.repeat(6000) }], 3000)).rejects.toThrow('上下文容量');
    expect(runJsonModelTask).not.toHaveBeenCalled();
  });
});
