// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { localStorage.clear(); vi.resetModules(); });
it.each(['accepted', 'dismissed'] as const)('restores the %s decision after an application restart, including a dismissal before generation', async decision => {
  const store = await import('./entryTagSuggestionStore');
  const key = store.tagSuggestionKey('workspace', 'paper');
  store.updateTagSuggestions(key, { decision }, true);
  vi.resetModules();
  const reopened = await import('./entryTagSuggestionStore');
  expect(reopened.readTagSuggestions(key).decision).toBe(decision);
  expect(reopened.readTagSuggestions(key).phase).toBe('idle');
});
it('keeps older pending caches compatible and rejects unknown decision values', async () => {
  const store = await import('./entryTagSuggestionStore');
  const key = store.tagSuggestionKey('workspace', 'paper');
  localStorage.setItem('neuink.entryTagRecommendations.v1:' + key, JSON.stringify({ generatedAt: '2026-10-26', recommendations: [], decision: 'invalid' }));
  expect(store.readTagSuggestions(key).decision).toBeNull();
  expect(store.readTagSuggestions(key).generatedAt).toBe('2026-10-26');
});
