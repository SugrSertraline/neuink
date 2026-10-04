// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_DEBUG_STORAGE_KEY, assistantErrorDiagnostic, formatAssistantError, formatAssistantToolSummary, readAssistantDebug, setAssistantDebug, useAssistantDebug } from './assistantDebug';
import { ASSISTANT_READ_FAILURES } from './assistantReadFailure';

beforeEach(() => { setAssistantDebug(false); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllEnvs(); setAssistantDebug(false); window.localStorage.clear(); });

describe('local assistant debug preference', () => {
  it('is off in development and only accepts an explicit saved true', () => {
    vi.stubEnv('DEV', true);
    expect(readAssistantDebug()).toBe(false);
    for (const value of ['1', 'TRUE', '{}', 'false']) {
      window.localStorage.setItem(ASSISTANT_DEBUG_STORAGE_KEY, value);
      expect(readAssistantDebug()).toBe(false);
    }
    setAssistantDebug(true);
    expect(readAssistantDebug()).toBe(true);
  });
  it('updates every mounted consumer and responds to cross-window changes', () => {
    const a = renderHook(useAssistantDebug), b = renderHook(useAssistantDebug);
    act(() => setAssistantDebug(true));
    expect(a.result.current).toBe(true); expect(b.result.current).toBe(true);
    act(() => {
      window.localStorage.setItem(ASSISTANT_DEBUG_STORAGE_KEY, 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: ASSISTANT_DEBUG_STORAGE_KEY }));
    });
    expect(a.result.current).toBe(false); expect(b.result.current).toBe(false);
    a.unmount(); b.unmount();
    expect(() => setAssistantDebug(true)).not.toThrow();
  });
  it('fails closed on unreadable storage and keeps an explicit session choice when persistence fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readAssistantDebug()).toBe(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    setAssistantDebug(true); expect(readAssistantDebug()).toBe(true);
    setAssistantDebug(false); expect(readAssistantDebug()).toBe(false);
  });
});

describe('safe assistant error presentation', () => {
  const raw = 'Timeout HTTP 504 Authorization: Bearer sk-secret X-API-Key: private-key C:\\Users\\Alice\\private.pdf /home/alice/private <html>remote private body</html>';
  it('keeps actionable fixed read guidance after completion without exposing arbitrary lookalikes', () => {
    const safe = ASSISTANT_READ_FAILURES.noText;
    expect(formatAssistantError(safe, { fallback: '本次执行已结束，部分操作未完成；请核对结果后再试。' })).toBe(safe);
    expect(formatAssistantError(safe, { fallback: '工具未完成，助手正在处理。' })).toBe('工具未完成，助手正在处理。');
    expect(formatAssistantError(`${safe} ${raw}`)).toBe('工具未完成，等待助手核对。');
    expect(formatAssistantError(safe, { debug: true })).toContain(safe);
  });
  it('does not classify the historical citation/output contract stop as user cancellation', () => {
    const old = 'Agent 未满足工具、溯源或输出合同，任务已停止。';
    expect(assistantErrorDiagnostic(old)).toBe('引用或输出要求未满足');
    expect(formatAssistantError(old)).toBe(ASSISTANT_READ_FAILURES.contract);
    expect(formatAssistantError(`${old} private body`)).toBe('工具未完成，等待助手核对。');
  });
  it('never exposes raw errors by default, including unknown objects', () => {
    expect(formatAssistantError(raw)).toBe('工具未完成，等待助手核对。');
    expect(formatAssistantError({ body: raw })).toBe('工具未完成，等待助手核对。');
  });
  it('shows only allowlisted diagnostics even after opt-in', () => {
    const formatted = formatAssistantError(raw, { debug: true });
    expect(formatted).toContain('请求超时 · HTTP 504');
    for (const privateText of ['sk-secret', 'Authorization', 'private-key', 'Alice', '/home', '<html>', 'remote private body'])
      expect(formatted).not.toContain(privateText);
    expect(assistantErrorDiagnostic(new TypeError('fetch failed; ' + raw))).toContain('TypeError');
    expect(assistantErrorDiagnostic('arbitrary remote sentence')).toBe('未分类异常');
  });
  it('does not stringify objects or read throwing error accessors', () => {
    const stringify = vi.fn(() => raw);
    expect(assistantErrorDiagnostic({ toString: stringify })).toBe('未分类异常');
    expect(stringify).not.toHaveBeenCalled();
    expect(() => assistantErrorDiagnostic({ get message() { throw new Error(raw); } })).not.toThrow();
  });
  it('explains citation and diagram validation using fixed safe categories', () => {
    expect(assistantErrorDiagnostic('Answer has no inline citation: Authorization: Bearer sk-private'))
      .toBe('引用或来源校验未通过');
    expect(assistantErrorDiagnostic('Mind map needs one root and valid parents. C:\\Users\\Alice\\private.md'))
      .toBe('图表结构校验未通过');
  });
  it.each([
    'Found 1 segment for "query" using semantic_fallback_keyword.',
    'Found 2 segments for "query" using hybrid_fallback_keyword.',
    'No parsed PDF segments matched "query" using semantic_fallback_keyword.',
  ])('protects known historical keyword-fallback summaries: %s', prefix => {
    const summary = `${prefix} Embedding search is unavailable: ${raw}. Showing keyword fallback results.`;
    expect(formatAssistantToolSummary(summary)).toBe('向量检索不可用，已使用关键词检索结果；现有证据仍可查看。');
    const debug = formatAssistantToolSummary(summary, true);
    expect(debug).toContain('调试：请求超时 · HTTP 504');
    for (const secret of ['sk-secret', 'Authorization', 'Alice', 'remote private body']) expect(debug).not.toContain(secret);
  });
  it('leaves normal success summaries and content-like quotations alone', () => {
    for (const summary of [undefined, '', 'Found 2 segments for "query" using keyword.',
      '论文解释 Embedding search is unavailable: 这个提示，并讨论关键词检索。',
      'Found 2 segments for "query" using hybrid_fallback_keyword. Semantic search is unavailable. These are keyword fallback results, not semantic matches.'])
      expect(formatAssistantToolSummary(summary, true)).toBe(summary);
  });
});
