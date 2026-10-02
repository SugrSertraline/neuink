import { describe, expect, it } from 'vitest';
import { assertResearchRetry, researchFailureMessage } from './researchRecovery';
import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';

const failure = (error = '远程服务返回 HTTP 403'): AssistantToolTraceEvent => ({
  id: 'call', toolName: 'read_webpage', status: 'error', input: { url: 'https://example.org/paper' }, error
});

describe('read failure recovery', () => {
  it.each([401, 403, 404, 410, 429])('does not refetch HTTP %s even with a different fragment or host-supplied root', status => {
    const events = [failure(`远程服务返回 HTTP ${status}`)];
    expect(() => assertResearchRetry('read_webpage', { root: 'workspace', url: 'https://example.org/paper#title' }, events)).toThrow('READ_RETRY_SKIPPED');
    expect(() => assertResearchRetry('read_webpage', { url: 'https://example.org/other' }, events)).not.toThrow();
    expect(() => assertResearchRetry('search_web', { query: 'paper' }, events)).not.toThrow();
  });
  it('bounds transient retries and derives the limit from serialized events', () => {
    const events = [failure('读取远程内容失败')];
    expect(() => assertResearchRetry('read_webpage', events[0].input, events)).not.toThrow();
    const restored = JSON.parse(JSON.stringify([...events, { ...events[0], id: 'second' }]));
    expect(() => assertResearchRetry('read_webpage', events[0].input, restored)).toThrow('READ_RETRY_SKIPPED');
  });
  it('does not treat successful page text as an error or change write/MCP semantics', () => {
    const event = { ...failure(), status: 'done' as const };
    expect(() => assertResearchRetry('read_webpage', event.input, [event])).not.toThrow();
    for (const name of ['import_papers', 'mcp_read_webpage', 'create_entry']) {
      expect(researchFailureMessage(name, 'HTTP 403')).toBe('HTTP 403');
    }
    expect(researchFailureMessage('read_webpage', 'HTTP 403')).toContain('不要再次请求同一目标');
    expect(researchFailureMessage('search_sciverse_evidence', 'timeout')).toContain('本轮已启用');
  });
});
