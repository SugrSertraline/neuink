import type { ToolSet } from 'ai';
import type { AssistantMessagePart, AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { researchPapersFromResult, type PaperCacheSource, type PaperSelection, type ResearchPaper } from '@/shared/ipc/researchApi';

type Batch = { toolName: string; researchPapers?: ResearchPaper[]; researchCacheSource?: PaperCacheSource;
  researchSearch?: unknown; status?: string; originConflict?: boolean };
export type SelectedPaper = { paper: ResearchPaper; cacheSource: PaperCacheSource | null };

function source(batch: Batch): PaperCacheSource | null {
  if (batch.originConflict) return null;
  const expected = batch.toolName === 'arxiv_search' ? 'arxiv_search' : batch.toolName === 'search_papers' ? 'research' : null;
  const search = batch.researchSearch as { schema_version?: unknown; status?: unknown } | undefined;
  if (batch.toolName === 'arxiv_search' && search !== undefined &&
      (!search || search.schema_version !== 1 || !['ok', 'partial'].includes(String(search.status)))) return null;
  const successful = batch.status === 'done' || (batch.status === undefined && batch.toolName === 'arxiv_search'
    && search?.schema_version === 1 && (search.status === 'ok' || search.status === 'partial'));
  return successful && expected && (batch.researchCacheSource === undefined || batch.researchCacheSource === expected) ? expected : null;
}
/** Stable event/part order, never completion timestamps. A later untrusted origin blocks actions. */
export function selectResearchPapers(batches: readonly Batch[]): SelectedPaper[] {
  const records = new Map<string, SelectedPaper>();
  for (const batch of batches) {
    if (batch.status === 'error' || batch.status === 'running') continue;
    for (const paper of researchPapersFromResult({ papers: batch.researchPapers })) {
      const raw = batch.researchPapers?.find(item => item.id === paper.id);
      const valid = raw && ['id', 'title', 'url', 'abstract_text', 'year', 'doi', 'provider', 'evidence_level']
        .every(key => typeof raw[key as keyof ResearchPaper] === 'string')
        && Array.isArray(raw.authors) && raw.authors.every(author => typeof author === 'string')
        && (raw.pdf_url === null || typeof raw.pdf_url === 'string');
      records.set(paper.id, { paper, cacheSource: valid ? source(batch) : null });
    }
  }
  return [...records.values()];
}
export const researchPapersFromEvents = (events: readonly AssistantToolTraceEvent[]) => selectResearchPapers(events);
export function researchPapersFromParts(parts: readonly AssistantMessagePart[]): SelectedPaper[] {
  const calls = new Map(parts.flatMap(part => part.type === 'tool-call' ? [[part.id, part] as const] : []));
  return selectResearchPapers(parts.flatMap(part => part.type === 'tool-result'
    ? [{ ...part, status: calls.get(part.id)?.status,
      originConflict: calls.has(part.id) && calls.get(part.id)?.toolName !== part.toolName }] : []));
}
export function resolvePaperSelections(events: readonly AssistantToolTraceEvent[], input: unknown): PaperSelection[] {
  const ids = (input as { paper_ids?: unknown } | null)?.paper_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw new Error('论文选择无效');
  }
  const records = new Map(researchPapersFromEvents(events).map(record => [record.paper.id, record]));
  return ids.map(paperId => {
    const record = records.get(paperId);
    if (!record?.cacheSource) throw new Error('无法确定论文检索来源，请重新检索后确认');
    return { paperId, cacheSource: record.cacheSource };
  });
}

// Host-only metadata on tool definitions. Never part of the model's schema or arguments.
type Resolver = (input: unknown) => PaperSelection[];
const resolvers = new WeakMap<object, Resolver>();
export function bindPaperSelections(tool: ToolSet[string], resolve: Resolver) { resolvers.set(tool, resolve); }
export function toolPaperSelections(tool: ToolSet[string], input: unknown) { return resolvers.get(tool)?.(input); }
