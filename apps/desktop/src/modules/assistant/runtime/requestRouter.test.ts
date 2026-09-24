import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseRequestRoute, routeAssistantRequest } from './requestRouter';
import type { AssistantRouteSignals } from '@/shared/ipc/assistantRoutingApi';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';

afterEach(() => vi.useRealTimers());
const input = (question: string) => ({ question, hasContext: false });
const signals: AssistantRouteSignals = { status: 'ready', version: 1, model: 'fixture',
  scores: [{ route: 'chat', similarity: 0.99 }, { route: 'edit', similarity: 0.4 }] };

describe('invisible request routing', () => {
  it.each(['你好', '您好！', 'Hello!', '  HI  ', '早上好。'])('fast-paths a standalone greeting: %s', text => {
    expect(baseRequestRoute(input(text)).path).toBe('lightweight_chat');
  });
  it.each(['你好，修改标题', '谢谢，顺便删除第二段', '你好\n删除笔记', '不要回复你好', '“你好”是什么意思',
    '好的，继续', '就这样做', '换一种', '为什么', '谢谢', '你好，找论文然后做PPT', '总结论文', '只给计划，不要修改',
    'Translate hello to Chinese', 'Hi, delete the note', '你好！谢谢！', 'hello world', '你好👍'])('abstains on mixed/negative/ambiguous intent: %s', text => {
    expect(baseRequestRoute(input(text)).path).toBe('main_agent');
  });
  it('does not use a shortcut when there is context, history, or a restored read-only request', () => {
    expect(baseRequestRoute({ ...input('你好'), hasContext: true }).reason).toBe('context');
    expect(baseRequestRoute({ ...input('你好'), history: [{} as ConversationMessage] }).reason).toBe('history');
    expect(baseRequestRoute({ ...input('你好'), legacyPlan: true }).reason).toBe('legacy_plan');
  });
  it('does not invoke embeddings for greetings or context-gated requests', async () => {
    const embed = vi.fn();
    await routeAssistantRequest(input('你好'), undefined, embed);
    await routeAssistantRequest({ ...input('总结论文'), hasContext: true }, undefined, embed);
    expect(embed).not.toHaveBeenCalled();
  });
  it('records scores in shadow mode without granting or removing task capabilities', async () => {
    const result = await routeAssistantRequest(input('谢谢，顺便删除第二段'), undefined, async () => signals);
    expect(result).toMatchObject({ path: 'main_agent', candidate: 'chat', shadow: true, semanticStatus: 'ready' });
    expect(result.margin).toBeCloseTo(0.59);
  });
  it.each(['busy', 'warming', 'unavailable', 'skipped'] as const)('falls back immediately on %s', async status => {
    expect(await routeAssistantRequest(input('帮我整理一下'), undefined, async () => ({ ...signals, status, scores: [] })))
      .toMatchObject({ path: 'main_agent', semanticStatus: status });
  });
  it('bounds waiting and ignores late predictions', async () => {
    vi.useFakeTimers();
    let finish!: (value: AssistantRouteSignals) => void;
    const result = routeAssistantRequest(input('帮我整理一下'), undefined, () => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(120);
    const route = await result;
    expect(route).toMatchObject({ path: 'main_agent', semanticStatus: 'timeout' });
    finish(signals);
    await Promise.resolve();
    expect(route.candidate).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('fails open only to the normal Agent, never to chat, on IPC failure', async () => {
    expect(await routeAssistantRequest(input('帮我整理一下'), undefined, async () => { throw new Error('no native runtime'); }))
      .toMatchObject({ path: 'main_agent', semanticStatus: 'error' });
  });
  it('treats malformed or synchronously failing signal providers as optional', async () => {
    expect(await routeAssistantRequest(input('帮我整理一下'), undefined, async () => ({ status: 'ready' }) as AssistantRouteSignals))
      .toMatchObject({ path: 'main_agent', semanticStatus: 'error' });
    expect(await routeAssistantRequest(input('帮我整理一下'), undefined, () => { throw new Error('unavailable'); }))
      .toMatchObject({ path: 'main_agent', semanticStatus: 'error' });
  });
  it('honors cancellation without waiting for inference', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = routeAssistantRequest(input('帮我整理一下'), controller.signal, () => new Promise(() => {}));
    const rejected = expect(promise).rejects.toThrow('stop');
    controller.abort(new Error('stop'));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('skips oversized requests rather than truncating away a later instruction', async () => {
    const embed = vi.fn();
    expect((await routeAssistantRequest(input('你好'.repeat(200) + '删除笔记'), undefined, embed)).path).toBe('main_agent');
    expect(embed).not.toHaveBeenCalled();
  });
});
