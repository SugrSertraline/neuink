import { getAssistantRouteSignals, type AssistantRouteSignals, type SemanticRoute } from '@/shared/ipc/assistantRoutingApi';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';

// Only standalone greetings are enforced initially. Semantic predictions stay in
// shadow mode until evaluated on real Chinese requests; similarity is NOT probability.
const GREETINGS = new Set(['你好', '您好', '你好呀', '你好啊', '嗨', '哈喽', '早上好', '下午好', '晚上好', 'hello', 'hi', 'hey']);
const normalizeGreeting = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/[!！。.,，?？～~]+$/u, '').trim();
export const isStandaloneGreeting = (text: string) => GREETINGS.has(normalizeGreeting(text));

export type RequestRoute = {
  version: 1;
  path: 'lightweight_chat' | 'main_agent';
  reason: 'greeting' | 'context' | 'history' | 'legacy_plan' | 'uncertain';
  semanticStatus: AssistantRouteSignals['status'] | 'not_needed' | 'timeout' | 'error';
  candidate?: SemanticRoute;
  similarity?: number;
  margin?: number;
  model?: string;
  shadow: true;
};

export function baseRequestRoute(input: {
  question: string;
  hasContext: boolean;
  history?: ConversationMessage[];
  legacyPlan?: boolean;
}): RequestRoute {
  const base = { version: 1, path: 'main_agent', semanticStatus: 'not_needed', shadow: true } as const;
  if (input.legacyPlan) return { ...base, reason: 'legacy_plan' };
  if (input.hasContext) return { ...base, reason: 'context' };
  // Conservatively retain ALL conversation semantics, including pending proposals,
  // unresolved questions, failed runs and short continuations. Never truncate them
  // into a supposedly independent chat request.
  if (input.history?.length) return { ...base, reason: 'history' };
  if (isStandaloneGreeting(input.question)) return { ...base, path: 'lightweight_chat', reason: 'greeting' };
  return { ...base, reason: 'uncertain' };
}

export async function routeAssistantRequest(
  input: Parameters<typeof baseRequestRoute>[0],
  signal?: AbortSignal,
  readSignals = getAssistantRouteSignals,
): Promise<RequestRoute> {
  signal?.throwIfAborted();
  const route = baseRequestRoute(input);
  // Fixed greetings need zero inference; context gates never need semantic guessing.
  if (route.reason !== 'uncertain' || [...input.question].length > 256) return route;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      readSignals(input.question).catch(() => null),
      new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), 120); }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    signal?.throwIfAborted();
    if (result === 'timeout') return { ...route, semanticStatus: 'timeout' };
    if (!result) return { ...route, semanticStatus: 'error' };
    if (!Array.isArray(result.scores)) return { ...route, semanticStatus: 'error' };
    const scores = [...result.scores].filter(score => Number.isFinite(score.similarity))
      .sort((left, right) => right.similarity - left.similarity);
    const [best, second] = scores;
    return { ...route, semanticStatus: result.status, model: result.model,
      ...(result.status === 'ready' && best && second ? {
        candidate: best.route, similarity: best.similarity, margin: best.similarity - second.similarity,
      } : {}) };
  } catch {
    signal?.throwIfAborted();
    return { ...route, semanticStatus: 'error' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function routeSummary(route: RequestRoute) {
  if (route.path === 'lightweight_chat') return '独立问候：直接回答，不读取资料或加载工具。';
  if (route.reason === 'context') return '包含阅读上下文或引用，由主助手按需处理。';
  if (route.reason === 'history') return '保留完整对话语义，由主助手判断后续任务。';
  if (route.reason === 'legacy_plan') return '恢复原只读请求，保留其权限边界。';
  const labels: Record<SemanticRoute, string> = { chat: '聊天', read: '阅读理解', edit: '内容修改', research: '多步骤研究', plan: '方案讨论', other: '未确定' };
  return route.candidate
    ? `本地语义候选：${labels[route.candidate]}（仅观察，不改变工具权限）；交由主助手处理。`
    : '未采用快捷路线，直接交由主助手处理。';
}
