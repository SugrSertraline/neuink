import { invoke } from '@tauri-apps/api/core';
export type ResearchSelection = { kind: 'entry'; entry_id: string } | { kind: 'note'; entry_id: string; note_id: string } | { kind: 'segment'; entry_id: string; segment_uid: string };
export type ResearchTaskSummary = { id: string; query: string; created_at: string; status: string; stage: string; model: string; error: string | null };
export type ResearchTask = ResearchTaskSummary & {
  profile_id: string; retriever: string; depth: 'brief' | 'standard' | 'deep'; timeout_seconds: number; report: string; source_urls: string[];
  parent_id?: string | null;
  documents: { id: string; title: string; evidence_level: string; text: string }[]; engine?: string; engine_version: string; cost_estimate: number | null;
};
export type ResearchStatus = { ready: boolean; version: string; error: string | null; pending_save: boolean; pending_task_id?: string | null; active: { id: string | null; installation: boolean; stage: string; progress?: number | null } | null };
export type ResearchScopePreview = { scope_hash: string; documents: { id: string; title: string; evidence_level: string; characters: number }[] };
export function deepResearchCommand<T>(root: string, action: Record<string, unknown>) { return invoke<T>('deep_research', { request: { root, action } }); }
