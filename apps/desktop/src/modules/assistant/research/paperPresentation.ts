import { isSciverseConversationSource, type ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { ResearchPaper } from '@/shared/ipc/researchApi';

export type PaperRecord = { ref: string } & (
  | { kind: 'research'; paper: ResearchPaper }
  | { kind: 'sciverse'; source: Extract<ConversationSourceLink, { provider: 'sciverse' }> }
);
export type PaperSelection = { ref: string; reason: string; group?: string };
export type PaperFragment = { kind: 'text'; text: string } | { kind: 'papers'; items: PaperSelection[] }
  | { kind: 'invalid' } | { kind: 'pending' };

export function paperRecords(papers: ResearchPaper[], sources: ConversationSourceLink[]) {
  const records = new Map<string, PaperRecord>();
  for (const paper of papers) records.set(`research:${paper.id}`, { ref: `research:${paper.id}`, kind: 'research', paper });
  for (const source of sources) if (isSciverseConversationSource(source)) {
    const ref = `sciverse:${source.doc_id}`;
    if (!records.has(ref)) records.set(ref, { ref, kind: 'sciverse', source });
  }
  return records;
}

/** Explicit presentation blocks, never title/URL matching or executable model-supplied actions. */
export function parsePaperPresentation(content: string, streaming = false): PaperFragment[] {
  const fragments: PaperFragment[] = [];
  const fence = /^```neuink-papers[ \t]*\r?\n/gm;
  let cursor = 0;
  for (let match = fence.exec(content); match; match = fence.exec(content)) {
    if (match.index > cursor) fragments.push({ kind: 'text', text: content.slice(cursor, match.index) });
    const start = fence.lastIndex;
    const end = /^```[ \t]*(?:\r?\n|$)/gm;
    end.lastIndex = start;
    const closing = end.exec(content);
    if (!closing) {
      fragments.push({ kind: streaming ? 'pending' : 'invalid' });
      return fragments;
    }
    try {
      const value = JSON.parse(content.slice(start, closing.index));
      if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 30) throw new Error('Invalid selection');
      const items: PaperSelection[] = value.items.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('Invalid item');
        const row = item as Record<string, unknown>;
        if (typeof row.ref !== 'string' || row.ref.length > 300 || !/^(research|sciverse):\S+$/.test(row.ref)
          || typeof row.reason !== 'string' || row.reason.length > 1200
          || (row.group !== undefined && (typeof row.group !== 'string' || row.group.length > 100))) throw new Error('Invalid fields');
        return { ref: row.ref, reason: row.reason, group: row.group as string | undefined };
      });
      fragments.push({ kind: 'papers', items });
    } catch { fragments.push({ kind: 'invalid' }); }
    cursor = end.lastIndex;
    fence.lastIndex = cursor;
  }
  if (cursor < content.length) fragments.push({ kind: 'text', text: content.slice(cursor) });
  return fragments;
}

export function paperPresentationError(text: string, records: Map<string, PaperRecord>) {
  const fragments = parsePaperPresentation(text);
  if (fragments.some(fragment => fragment.kind === 'invalid')) return 'Invalid neuink-papers block. Use JSON {"items":[{"ref":"exact paper_ref from a tool result","reason":"supported recommendation reason","group":"optional heading"}]} inside a closed neuink-papers code fence.';
  const items = fragments.flatMap(fragment => fragment.kind === 'papers' ? fragment.items : []);
  if (items.some(item => !records.has(item.ref))) return 'A recommended paper_ref was not retrieved in this run. Use only exact paper_ref values from successful retrieval results; never invent a paper or an import action.';
  if (new Set(items.map(item => item.ref)).size !== items.length) return 'Do not repeat the same paper_ref in the recommended list.';
}

export const PAPER_PRESENTATION_INSTRUCTIONS = [
  'For paper recommendations, the answer itself must be an interactive paper list, not a Markdown table plus a separate download list.',
  'Select and order actual retrieved papers using a fenced block with language neuink-papers and JSON {"items":[{"ref":"exact paper_ref from the retrieval result","reason":"brief supported recommendation and limitations","group":"optional category"}]}. Use at most 30 items. You may place short prose before/after the block.',
  'The host validates refs and renders original titles, authors and years with View/Add buttons in each row. Do not repeat these papers in a Markdown table, invent metadata/buttons, or mention internal tool names to users. A block only displays recommendations, never authorizes importing. Unselected candidates are collapsed separately.',
  'Keep [S#] citations or exact source URLs in recommendation reasons where appropriate. arXiv/provider names do not prove conference acceptance; mark unverified venue explicitly. If no suitable retrieved paper exists, explain the limitation instead of creating an empty or fabricated list.'
].join('\n');
