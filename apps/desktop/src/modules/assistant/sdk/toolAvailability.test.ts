import { describe, expect, it } from 'vitest';
import { InvalidToolInputError, NoSuchToolError, jsonSchema, tool, type ModelMessage } from 'ai';
import { availableTurnTools, toolCallError } from './toolAvailability';

const definition = () => tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }) });
const tools = { search_sciverse_evidence: definition(), read_sciverse_content: definition(), note_propose_create: definition() };
const result = (toolName: string, failed = false): ModelMessage => ({ role: 'tool', content: [{
  type: 'tool-result', toolCallId: 'test', toolName,
  output: failed ? { type: 'error-text', value: 'Failed' } : { type: 'json', value: { evidence: 'actual' } }
}] });

describe('authoritative per-turn tool availability', () => {
  it('synthesizes after an explicit host tool limit without needing three more errors', () => {
    const message: ModelMessage = { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'limit', toolName: 'read_note',
      output: { type: 'error-text', value: 'TOOL_LIMIT_REACHED：没有新信息，本次未执行' } }] };
    expect(availableTurnTools(tools, [message])).toMatchObject({ tools: {}, finish: true });
  });
  it('lists only actual declarations and never invents capabilities from history', () => {
    const selected = availableTurnTools(tools, [result('search_web', true)]);
    expect(Object.keys(selected.tools)).toEqual(Object.keys(tools));
    expect(selected.instructions).not.toContain('search_web');
    expect(selected.instructions).not.toContain('search_papers');
    expect(selected.instructions).toContain('Do not enable disabled tools');
  });
  it('caps search across providers, but keeps reading and confirmed-write tools', () => {
    const messages = Array.from({ length: 6 }, (_, i) => result(i % 2 ? 'search_papers' : 'search_sciverse_evidence'));
    const selected = availableTurnTools(tools, structuredClone(messages));
    expect(Object.keys(selected.tools)).toEqual(['read_sciverse_content', 'note_propose_create']);
    expect(selected.finish).toBe(false);
    expect(selected.instructions).toContain('search budget is reached');
    expect(tools.search_sciverse_evidence).toBeDefined();
  });
  it('switches to synthesis after three consecutive errors, but resets the streak after success', () => {
    const failures = Array.from({ length: 3 }, () => result('missing', true));
    expect(availableTurnTools(tools, failures)).toMatchObject({ tools: {}, finish: true });
    expect(availableTurnTools(tools, [...failures, result('read_sciverse_content')]).finish).toBe(false);
  });
  it('reserves the final model turn for a grounded answer without tools', () => {
    const selected = availableTurnTools(tools, [], true);
    expect(selected).toMatchObject({ tools: {}, finish: true });
    expect(selected.instructions).toContain('Never claim');
  });
  it('handles an empty user selection', () => {
    expect(availableTurnTools({}, []).instructions).toContain('(none)');
  });
  it('distinguishes unavailable tools from malformed input without exposing SDK payloads', () => {
    expect(toolCallError('search_web', new NoSuchToolError({ toolName: 'search_web' }), tools)).toContain('TOOL_UNAVAILABLE');
    const invalid = new InvalidToolInputError({ toolName: 'read_sciverse_content', toolInput: 'secret-argument', cause: 'private-request' });
    const message = toolCallError('read_sciverse_content', invalid, tools);
    expect(message).toContain('INVALID_TOOL_INPUT');
    expect(message).not.toMatch(/secret-argument|private-request/);
  });
});
