import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

export function scriptedModel(turns: Array<{ text?: string; call?: { name: string; args: unknown } }>) {
  let index = 0;
  return new MockLanguageModelV3({ doStream: async () => {
    const turn = turns[index++];
    if (!turn) throw new Error('Unexpected provider turn');
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      ...(turn.call ? [{ type: 'tool-call' as const, toolCallId: `call-${index}`, toolName: turn.call.name, input: JSON.stringify(turn.call.args) }] : [
        { type: 'text-start' as const, id: 'text' }, { type: 'text-delta' as const, id: 'text', delta: turn.text! }, { type: 'text-end' as const, id: 'text' }
      ]),
      { type: 'finish', finishReason: { unified: turn.call ? 'tool-calls' : 'stop', raw: turn.call ? 'tool_calls' : 'stop' },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } }
    ] }) };
  } });
}
