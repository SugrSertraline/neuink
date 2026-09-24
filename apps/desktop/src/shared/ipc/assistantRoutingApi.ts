import { invoke } from '@tauri-apps/api/core';

export type SemanticRoute = 'chat' | 'read' | 'edit' | 'research' | 'plan' | 'other';
export type AssistantRouteSignals = {
  status: 'ready' | 'busy' | 'warming' | 'unavailable' | 'skipped';
  model: string;
  version: number;
  scores: Array<{ route: SemanticRoute; similarity: number }>;
};

export const getAssistantRouteSignals = (text: string | null) =>
  invoke<AssistantRouteSignals>('assistant_route_signals', { text });

let warming: Promise<unknown> | undefined;
export function warmAssistantRouter() {
  // No text, network, state updates, or per-conversation ownership in this cache.
  warming ??= getAssistantRouteSignals(null).catch(() => undefined);
  return warming;
}
