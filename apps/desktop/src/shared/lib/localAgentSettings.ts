import { useSyncExternalStore } from 'react';

export const CLAUDE_CODE_DISPLAY_NAME = 'Claude Code';
export const LOCAL_AGENTS = [
  { id: 'claude', name: CLAUDE_CODE_DISPLAY_NAME },
  { id: 'codex', name: 'Codex' },
  { id: 'opencode', name: 'OpenCode' },
] as const;
export type LocalAgentProvider = typeof LOCAL_AGENTS[number]['id'];
export type AssistantEngine = 'model' | LocalAgentProvider;
export const localAgentName = (provider: LocalAgentProvider) => LOCAL_AGENTS.find(agent => agent.id === provider)!.name;

const KEY = 'neuink.localAgent.enabled';
const ENGINE_KEY = 'neuink.assistant.lastEngine';
const EVENT = 'neuink:local-agent-settings';
export function readLastAssistantEngine(): AssistantEngine {
  try {
    const value = window.localStorage.getItem(ENGINE_KEY);
    return LOCAL_AGENTS.find(agent => agent.id === value)?.id ?? 'model';
  } catch { return 'model'; }
}
export function saveLastAssistantEngine(engine: AssistantEngine): boolean {
  try { window.localStorage.setItem(ENGINE_KEY, engine); return true; }
  catch { return false; }
}
export function readLocalAgentEnabled() {
  try { return window.localStorage.getItem(KEY) === 'true'; } catch { return false; }
}
export function setLocalAgentEnabled(enabled: boolean) {
  window.localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeLocalAgentSettings(listener: () => void) {
  window.addEventListener(EVENT, listener); window.addEventListener('storage', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); };
}
export const useLocalAgentEnabled = () => useSyncExternalStore(subscribeLocalAgentSettings, readLocalAgentEnabled);
