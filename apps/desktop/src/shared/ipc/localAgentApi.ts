import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { LocalAgentProvider } from '@/shared/lib/localAgentSettings';

export type LocalAgentDetection = { status: 'detected' | 'missing' | 'error'; message: string };

export async function detectClaudeCode(): Promise<LocalAgentDetection> {
  if (!isTauri()) return { status: 'error', message: '请在 NeuInk 桌面应用中检测本地工具。' };
  return invoke<LocalAgentDetection>('detect_claude_code');
}
export async function detectLocalAgent(provider: LocalAgentProvider): Promise<LocalAgentDetection> {
  if (provider === 'claude') return detectClaudeCode();
  if (!isTauri()) return { status:'error', message:'请在 NeuInk 桌面应用中检测本地工具。' };
  return invoke<LocalAgentDetection>('detect_local_agent', {provider});
}

export async function testLocalAgentConnection(provider: LocalAgentProvider, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!isTauri()) throw new Error('请在 NeuInk 桌面应用中使用本地 Agent。');
  const runId = crypto.randomUUID();
  const cancel = () => { void invoke('cancel_local_agent', { runId }).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('test_local_agent_connection', { provider, runId });
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', cancel); }
}

export type LocalAgentEvent = { type: 'message'; value: Record<string, unknown> }
  | { type: 'tool'; id: string; name: string; input: unknown };
export type LocalAgentRequest = {
  runId: string; root: string; conversationId: string; prompt: string;
  sessionId: string; resume: boolean;
  provider?: LocalAgentProvider;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
};
export async function runLocalAgent(request: LocalAgentRequest, signal: AbortSignal | undefined,
  onEvent: (event: LocalAgentEvent) => void, handleTool: (event: Extract<LocalAgentEvent, { type: 'tool' }>) => Promise<unknown>) {
  signal?.throwIfAborted();
  if (!isTauri()) throw new Error('请在 NeuInk 桌面应用中使用本地 Agent。');
  let closed = false;
  let eventError: unknown;
  const cancel = () => { void invoke('cancel_local_agent', { runId: request.runId }).catch(() => undefined); };
  const channel = new Channel<LocalAgentEvent>();
  channel.onmessage = event => {
    if (closed || eventError || signal?.aborted) return;
    if (event.type === 'message') {
      try { onEvent(event); } catch (error) { eventError = error; cancel(); }
    }
    else void (async () => {
      let output: unknown;
      try { output = await handleTool(event); }
      catch { output = { isError: true, content: [{ type: 'text', text: '工具未完成，请查看对话中的错误或取消状态。' }] }; }
      if (!closed && !eventError && !signal?.aborted) await invoke('respond_local_agent', { runId: request.runId, requestId: event.id, output });
    })().catch(() => {
      if (!closed) { eventError = new Error('NeuInk 工具结果未能送达本地 Agent，本次任务已停止，请重试。'); cancel(); }
    });
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await invoke<Record<string, unknown>>('run_local_agent', { request, onEvent: channel });
    if (eventError) throw eventError;
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    if (eventError) throw eventError;
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : '本地 Agent 调用失败，请重试。');
  } finally { closed = true; signal?.removeEventListener('abort', cancel); }
}
