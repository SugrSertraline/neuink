import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const RESEARCH_READ_TOOLS = ['search_papers', 'search_web', 'read_webpage'] as const;
export const RESEARCH_TOOLS = [...RESEARCH_READ_TOOLS, 'import_papers'] as const;
export function isResearchTool(name: string) { return RESEARCH_TOOLS.some(id => id === name); }
export type ResearchSettings = { papers_enabled: boolean; web_enabled: boolean; has_web_key: boolean; use_tavily: boolean };
export type ResearchPaper = {
  id: string; title: string; authors: string[]; year: string; abstract_text: string;
  doi: string; url: string; pdf_url: string | null; provider: string; evidence_level: string;
};
/** Only native retrieval records create UI actions, never parsed assistant Markdown. */
export function researchPapersFromResult(value: unknown): ResearchPaper[] {
  const rows = (value as { papers?: unknown } | null)?.papers;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.filter((row): row is ResearchPaper => {
    if (!row || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.url !== 'string' || seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).slice(0, 20).map(row => ({ id: row.id, title: row.title.slice(0, 600), url: row.url,
    authors: Array.isArray(row.authors) ? row.authors.filter(author => typeof author === 'string').slice(0, 12) : [],
    abstract_text: String(row.abstract_text ?? '').slice(0, 2400), year: String(row.year ?? ''),
    doi: String(row.doi ?? ''), pdf_url: typeof row.pdf_url === 'string' ? row.pdf_url : null,
    provider: String(row.provider ?? ''), evidence_level: String(row.evidence_level ?? '') }));
}
export const getResearchSettings = () => invoke<ResearchSettings>('get_research_settings');
export const saveResearchSettings = (request: Omit<ResearchSettings, 'has_web_key'> & { web_key?: string }) =>
  invoke<ResearchSettings>('save_research_settings', { request });
export const previewResearchImport = (root: string, paper_ids: string[]) =>
  invoke<ResearchPaper[]>('preview_research_import', { request: { root, paper_ids } });
export const approveResearchImport = (root: string, paper_ids: string[], expected: ResearchPaper[], approval_id: string) =>
  invoke<void>('approve_research_import', { request: { root, paper_ids, expected, approval_id } });

export function onResearchLibraryChanged(root: string, onChange: () => void, onError: (error: unknown) => void) {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  let closed = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  void listen<{ root: string }>('research-library-changed', event => {
    if (closed || event.payload.root !== root) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!closed) onChange(); }, 100);
  }).then(stop => { if (closed) stop(); else unlisten = stop; })
    .catch(error => { if (!closed) onError(error); });
  return () => { closed = true; clearTimeout(timer); unlisten?.(); };
}

// A UI-only, one-shot handoff. Never serialize consent into model input/checkpoints.
const consents = new Map<string, { id: string; expires: number }>();
const consentKey = (root: string, call: string) => JSON.stringify([root, call]);
function prune() { for (const [key, value] of consents) if (value.expires <= Date.now()) consents.delete(key); }
export function rememberResearchConsent(root: string, call: string, id: string) {
  prune();
  const key = consentKey(root, call);
  if (consents.has(key) || consents.size >= 32) throw new Error('确认状态冲突，请停止任务后重新确认。');
  consents.set(key, { id, expires: Date.now() + 300_000 });
}
function takeConsent(root: string, call: string) {
  prune();
  const key = consentKey(root, call);
  const value = consents.get(key);
  consents.delete(key);
  if (!value) throw new Error('请先预览并确认本次论文下载。');
  return value.id;
}
export async function runResearchTool(name: string, input: Record<string, unknown>, signal?: AbortSignal, toolCallId = '') {
  signal?.throwIfAborted();
  const { root, ...args } = input;
  const approval_id = name === 'import_papers' ? takeConsent(String(root), toolCallId) : undefined;
  const call_id = crypto.randomUUID();
  const cancel = () => { void invoke('cancel_research_call', { callId: call_id }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await invoke<unknown>('run_research_tool', { request: { root, name, args, call_id, approval_id } });
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
