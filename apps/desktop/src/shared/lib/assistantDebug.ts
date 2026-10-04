import { useSyncExternalStore } from 'react';
import { safeAssistantReadFailure } from './assistantReadFailure';

export const ASSISTANT_DEBUG_STORAGE_KEY = 'neuink.assistant.debug';
const CHANGE_EVENT = 'neuink:assistant-debug-change';
let sessionOverride: boolean | undefined;

/** This opt-in is local UI state, never inferred from the build mode or sent to a model. */
export function readAssistantDebug(): boolean {
  if (sessionOverride !== undefined) return sessionOverride;
  try { return typeof window !== 'undefined' && window.localStorage.getItem(ASSISTANT_DEBUG_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

export function setAssistantDebug(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ASSISTANT_DEBUG_STORAGE_KEY, enabled ? 'true' : 'false');
    sessionOverride = undefined;
  } catch { sessionOverride = enabled; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ASSISTANT_DEBUG_STORAGE_KEY || event.key === null) {
      sessionOverride = undefined;
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useAssistantDebug(): boolean {
  return useSyncExternalStore(subscribe, readAssistantDebug, () => false);
}

export const ASSISTANT_TOOL_PENDING = '工具未完成，助手正在处理。';
export const ASSISTANT_TOOL_INCOMPLETE = '工具未完成，等待助手核对。';
export const ASSISTANT_TOOL_ANSWERED = '助手已根据可用结果完成回答，部分操作未完成。';
export const ASSISTANT_TOOL_ENDED = '本次执行已结束，部分操作未完成；请核对结果后再试。';
export const ASSISTANT_TOOL_STOPPED = '本次执行已停止，部分操作未完成；请先核对已有结果。';
export const ASSISTANT_ACTION_INCOMPLETE = '操作未完成，请核对目标内容后重试。';
export const ASSISTANT_IMPORT_INCOMPLETE = '论文添加未完成，请先核对条目库。';

/** A failed historical tool is not a promise of future work, nor proof that the final answer failed. */
export function assistantToolErrorNotice({ streaming, hasAnswer, runStatus }: {
  streaming: boolean; hasAnswer: boolean; runStatus?: 'running' | 'succeeded' | 'failed' | 'canceled';
}): string {
  if (streaming) return ASSISTANT_TOOL_PENDING;
  if (runStatus === 'canceled') return ASSISTANT_TOOL_STOPPED;
  if (runStatus === 'failed') return ASSISTANT_TOOL_ENDED;
  if (runStatus === 'succeeded' || hasAnswer) return ASSISTANT_TOOL_ANSWERED;
  return ASSISTANT_TOOL_ENDED;
}

/** Arbitrary provider messages can contain credentials, paths, headers or remote bodies.
 * Debug output is an allowlisted diagnostic summary, not a best-effort redacted raw string. */
export function assistantErrorDiagnostic(error: unknown): string {
  const knownFailure = safeAssistantReadFailure(error);
  if (knownFailure && /引用|来源核实/.test(knownFailure)) return '引用或输出要求未满足';
  let text = '';
  try {
    text = typeof error === 'string' ? error : error instanceof Error ? `${error.name} ${error.message}`
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
  } catch { /* Unknown errors may have throwing accessors; never stringify their payload. */ }
  text = text.slice(0, 8192);
  const categories: Array<[RegExp, string]> = [
    [/timeout|timed? out|超时/i, '请求超时'],
    [/abort|cancel|取消|停止/i, '操作已中止'],
    [/unauthori[sz]ed|forbidden|authentication|鉴权|认证|无权限/i, '认证或权限检查未通过'],
    [/rate.?limit|too many requests|限流|频率/i, '服务限流'],
    [/network|fetch failed|connection|网络|连接/i, '连接未完成'],
    [/conflict|revision|changed|冲突|版本|已变更/i, '目标版本冲突'],
    [/not found|does not exist|missing|不存在|缺失|未找到/i, '目标或配置不可用'],
    [/citation|source marker|inline source|引用|溯源/i, '引用或来源校验未通过'],
    [/mind map|diagram|\bnode\b|图表|节点/i, '图表结构校验未通过'],
    [/invalid|validation|schema|参数|校验|格式/i, '输入或结果校验未通过'],
    [/provider|server|service|服务/i, '外部服务未完成'],
  ];
  const category = categories.find(([pattern]) => pattern.test(text))?.[1] ?? '未分类异常';
  const status = text.match(/\b(?:HTTP(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*([45]\d{2})\b/i)?.[1];
  const kind = text.match(/\b(AbortError|TypeError|ReferenceError|SyntaxError|RangeError)\b/)?.[1];
  return [category, status ? `HTTP ${status}` : null, kind].filter(Boolean).join(' · ');
}

/** fallback must be trusted UI copy, never a caught error or a remote response. */
export function formatAssistantError(error: unknown, options: { debug?: boolean; fallback?: string } = {}): string {
  const fallback = options.fallback ?? ASSISTANT_TOOL_INCOMPLETE;
  // Once processing has ended, a fixed host-classified read failure is actionable without
  // exposing debug data or falsely warning that a read may have changed user content.
  const message = fallback === ASSISTANT_TOOL_PENDING || fallback === ASSISTANT_TOOL_STOPPED
    ? fallback : safeAssistantReadFailure(error) ?? fallback;
  return options.debug ? `${message} 调试：${assistantErrorDiagnostic(error)}` : message;
}

/** Display metadata only: never pass answer text, paper content, source quotes or tool arguments.
 * Older successful keyword-fallback summaries embedded raw storage/provider errors. Match that
 * exact host-generated shape so ordinary successful summaries and evidence remain untouched. */
export function formatAssistantToolSummary(summary: string | undefined, debug = false): string | undefined {
  if (!summary || !/^(?:Found \d+ segments? for "[\s\S]*" using |No parsed PDF segments matched "[\s\S]*" using )(?:semantic|hybrid)_fallback_keyword\. Embedding search is unavailable:/.test(summary)) return summary;
  return formatAssistantError(summary, { debug, fallback: '向量检索不可用，已使用关键词检索结果；现有证据仍可查看。' });
}
