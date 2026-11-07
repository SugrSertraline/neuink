import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { sameWorkspacePath } from '../lib/workspacePath';

export const RESEARCH_READ_TOOLS = ['search_papers', 'arxiv_search', 'search_web', 'read_webpage'] as const;
export const RESEARCH_TOOLS = [...RESEARCH_READ_TOOLS, 'import_papers'] as const;
export function isResearchTool(name: string) { return RESEARCH_TOOLS.some(id => id === name); }
export type ResearchSettings = { papers_enabled: boolean; web_enabled: boolean; has_web_key: boolean; use_tavily: boolean };
export type PaperCacheSource = 'research' | 'arxiv_search';
export type PaperSelection = { paperId: string; cacheSource: PaperCacheSource };
export type ResearchPaper = {
  id: string; title: string; authors: string[]; year: string; abstract_text: string;
  doi: string; url: string; pdf_url: string | null; provider: string; evidence_level: string;
  base_id?: string; categories?: string[]; primary_category?: string;
  published?: string; updated?: string; comment?: string; journal_ref?: string; rank?: number;
};
/** Only native retrieval records create UI actions, never parsed assistant Markdown. */
export function researchPapersFromResult(value: unknown): ResearchPaper[] {
  const rows = (value as { papers?: unknown } | null)?.papers;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.filter((row): row is ResearchPaper => {
    if (!row || typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.url !== 'string' || seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).map(row => ({ id: row.id, title: row.title, url: row.url,
    authors: Array.isArray(row.authors) ? row.authors.filter(author => typeof author === 'string') : [],
    abstract_text: String(row.abstract_text ?? ''), year: String(row.year ?? ''),
    doi: String(row.doi ?? ''), pdf_url: typeof row.pdf_url === 'string' ? row.pdf_url : null,
    provider: String(row.provider ?? ''), evidence_level: String(row.evidence_level ?? ''),
    ...researchMetadata(row) }));
}

function researchMetadata(row: ResearchPaper): Partial<ResearchPaper> {
  const metadata: Partial<ResearchPaper> = {};
  for (const key of ['base_id', 'primary_category', 'published', 'updated', 'comment', 'journal_ref'] as const) {
    if (typeof row[key] === 'string') metadata[key] = row[key];
  }
  if (Array.isArray(row.categories)) metadata.categories = row.categories.filter(category => typeof category === 'string');
  if (typeof row.rank === 'number' && Number.isSafeInteger(row.rank) && row.rank >= 1) metadata.rank = row.rank;
  return metadata;
}
export const getResearchSettings = () => invoke<ResearchSettings>('get_research_settings');
export const saveResearchSettings = (request: Omit<ResearchSettings, 'has_web_key'> & { web_key?: string }) =>
  invoke<ResearchSettings>('save_research_settings', { request });
export const previewResearchImport = (root: string, paper_ids: string[]) =>
  invoke<ResearchPaper[]>('preview_research_import', { request: { root, paper_ids } });
export const approveResearchImport = (root: string, paper_ids: string[], expected: ResearchPaper[], approval_id: string) =>
  invoke<void>('approve_research_import', { request: { root, paper_ids, expected, approval_id } });
export const previewSelectedImport = (root: string, selections: readonly PaperSelection[]) =>
  invoke<ResearchPaper[]>('preview_arxiv_import', { request: { root, selections } });
export const approveSelectedImport = (root: string, selections: readonly PaperSelection[], expected: ResearchPaper[], approval_id: string) =>
  invoke<void>('approve_arxiv_import', { request: { root, selections, expected, approval_id } });

export function onResearchLibraryChanged(root: string, onChange: () => void, onError: (error: unknown) => void) {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  let closed = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  void listen<{ root: string }>('research-library-changed', event => {
      if (closed || !sameWorkspacePath(event.payload.root, root)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!closed) onChange(); }, 100);
  }).then(stop => { if (closed) stop(); else unlisten = stop; })
    .catch(error => { if (!closed) onError(error); });
  return () => { closed = true; clearTimeout(timer); unlisten?.(); };
}

// A UI-only, one-shot handoff. Never serialize consent into model input/checkpoints.
const consents = new Map<string, { id: string; expires: number; selections?: PaperSelection[] }>();
const consentKey = (root: string, call: string) => JSON.stringify([root, call]);
/** Raised only by the local consent preflight, before dispatching a native import. */
export class ResearchImportNotApprovedError extends Error {}
function prune() { for (const [key, value] of consents) if (value.expires <= Date.now()) consents.delete(key); }
export function rememberResearchConsent(root: string, call: string, id: string, selections?: readonly PaperSelection[]) {
  prune();
  const key = consentKey(root, call);
  if (consents.has(key) || consents.size >= 32) throw new Error('确认状态冲突，请停止任务后重新确认。');
  consents.set(key, { id, expires: Date.now() + 300_000, selections: selections ? structuredClone([...selections]) : undefined });
}
function takeConsent(root: string, call: string) {
  prune();
  const key = consentKey(root, call);
  const value = consents.get(key);
  consents.delete(key);
  if (!value) throw new ResearchImportNotApprovedError('请先预览并确认本次论文下载。');
  return value;
}
export async function runResearchTool(name: string, input: Record<string, unknown>, signal?: AbortSignal, toolCallId = '') {
  signal?.throwIfAborted();
  const { root, ...args } = input;
  const consent = name === 'import_papers' ? takeConsent(String(root), toolCallId) : undefined;
  const approval_id = consent?.id;
  if (consent?.selections && JSON.stringify(args.paper_ids) !== JSON.stringify(consent.selections.map(item => item.paperId))) {
    throw new ResearchImportNotApprovedError('论文选择已变化，请重新确认。');
  }
  const call_id = crypto.randomUUID();
  const cancel = () => { void invoke('cancel_research_call', { callId: call_id }).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (consent?.selections) return await invoke<unknown>('run_arxiv_import', { request: {
      root, selections: consent.selections, approval_id, call_id,
    } });
    return await invoke<unknown>('run_research_tool', { request: { root, name, args, call_id, approval_id } });
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
