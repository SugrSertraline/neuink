import { type SciverseContentResponse, type SciverseJsonResponse } from '@/modules/sciverse/types';
import {
  type AssistantContextSnapshot,
  type ConversationSourceLink,
  type ReadSegmentContentResponse
} from '@/shared/ipc/assistantApi';
import { readNote, type SearchHit, type SearchResults } from '@/shared/ipc/workspaceApi';
import { type AssistantActiveNote } from '@/shared/types/assistant';
import { stableHash } from '../runtime/evidenceLedger';
import { compactQuote, type JsonObject, optionalNumber, optionalString, trimToBudget } from './toolValues';

type ToolEvidence = {
  entry_id: string;
  entry_title: string;
  marker: string;
  page: number;
  score?: number;
  segment_uid: string;
  snippet?: string;
  text?: string;
};

export async function readCurrentNoteOutput({
  contextSnapshot,
  contextBudget,
  currentNote,
  root
}: {
  contextSnapshot?: AssistantContextSnapshot | null;
  contextBudget: number;
  currentNote?: AssistantActiveNote | null;
  root: string;
}) {
  const hydrated = contextSnapshot?.active_note;
  const target = currentNote ?? (hydrated
    ? {
        entryId: hydrated.entry_id,
        entryTitle: hydrated.entry_title,
        noteId: hydrated.note_id,
        noteTitle: hydrated.note_title
      }
    : null);
  if (!target) {
    return {
      modelOutput: {
        available: false,
        kind: 'read_current_note',
        reason: 'No Markdown note was explicitly selected.'
      },
      summary: 'No selected Markdown note is available.'
    };
  }

  const budget = Math.min(36_000, contextBudget);
  const note = await readNote(root, target.entryId, target.noteId);
  const truncated = note.markdown.length > budget;
  const markdown = trimToBudget(note.markdown, budget);

  return {
    modelOutput: {
      available: true,
      content_hash: stableHash(note.markdown),
      entry_id: target.entryId,
      entry_title: target.entryTitle,
      kind: 'read_current_note',
      markdown,
      markdown_char_count: note.markdown.length,
      note_id: target.noteId,
      note_title: note.title || target.noteTitle,
      numbered_markdown: numberMarkdownLines(markdown),
      source_link_count: note.links.length,
      truncated
    },
    snapshot: {
      markdown: note.markdown,
      title: note.title || target.noteTitle
    },
    summary: truncated
      ? `Read selected note "${note.title || target.noteTitle}" with truncation.`
      : `Read selected note "${note.title || target.noteTitle}".`
  };
}

export function numberMarkdownLines(markdown: string) {
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
}

export function formatSearchSegmentsOutput(
  results: SearchResults,
  addSource: (source: ConversationSourceLink) => number
) {
  const hits = results.entries.flatMap((group) => group.hits).slice(0, 24);
  const evidence = hits
    .filter((hit): hit is SearchHit & { target: { kind: 'segment'; entry_id: string; segment_uid: string; page_idx: number } } => hit.target.kind === 'segment')
    .slice(0, 12)
    .map((hit) => {
      const source: ConversationSourceLink = {
        entry_id: hit.target.entry_id,
        entry_title: hit.entry_title,
        page_idx: hit.target.page_idx,
        quote: compactQuote(hit.snippet),
        segment_uid: hit.target.segment_uid
      };
      const marker = addSource(source);
      return {
        entry_id: source.entry_id,
        entry_title: source.entry_title,
        marker: `[S${marker}]`,
        page: source.page_idx + 1,
        score: hit.score,
        segment_uid: source.segment_uid,
        snippet: hit.snippet
      } satisfies ToolEvidence;
    });

  // Backend warnings may embed provider errors and private model paths. Keep the
  // successful evidence, but expose only host-owned degradation copy.
  const keywordFallback = results.mode === 'semantic_fallback_keyword' || results.mode === 'hybrid_fallback_keyword';
  const warnings = keywordFallback
    ? ['Semantic search is unavailable. These are keyword fallback results, not semantic matches.']
    : results.warnings?.length ? ['Search reported a limitation. Use only the returned evidence; completeness is not guaranteed.'] : [];
  const modelOutput = {
    evidence,
    kind: 'search_segments',
    mode: results.mode,
    query: results.query,
    total_hit_count: results.total_hit_count,
    warnings
  };

  const warningText = warnings.length > 0 ? ` ${warnings.join(' ')}` : '';

  return {
    modelOutput,
    sources: evidence.map((item) => sourceFromEvidence(item)),
    summary:
      evidence.length > 0
        ? `Found ${evidence.length} segment${evidence.length === 1 ? '' : 's'} for "${results.query}" using ${results.mode}.${warningText}`
        : `No parsed PDF segments matched "${results.query}" using ${results.mode}.${warningText}`
  };
}

export function formatReadSegmentOutput(
  result: ReadSegmentContentResponse,
  addSource: (source: ConversationSourceLink) => number,
  contextBudget: number
) {
  const text = trimToBudget(result.text, Math.min(8_000, contextBudget));
  const source: ConversationSourceLink = {
    entry_id: result.entry_id,
    entry_title: result.entry_title,
    page_idx: result.page_idx,
    quote: compactQuote(text),
    segment_uid: result.segment_uid
  };
  const marker = addSource(source);
  const evidence: ToolEvidence = {
    entry_id: source.entry_id,
    entry_title: source.entry_title,
    marker: `[S${marker}]`,
    page: source.page_idx + 1,
    segment_uid: source.segment_uid,
    text
  };

  return {
    modelOutput: {
      evidence,
      kind: 'read_segment_content'
    },
    sources: [source],
    summary: `Read ${result.entry_title}, p.${result.page_idx + 1}.`
  };
}

export function formatSciverseContentOutput(
  result: SciverseContentResponse,
  input: JsonObject,
  addSource: (source: ConversationSourceLink) => number,
  contextBudget: number
) {
  const text = trimToBudget(result.text, Math.min(12_000, contextBudget));
  const source: ConversationSourceLink = {
    provider: 'sciverse',
    doc_id: String(input.doc_id),
    chunk_id: optionalString(input.chunk_id),
    title: optionalString(input.title) ?? `Sciverse document ${String(input.doc_id)}`,
    quote: compactQuote(text),
    offset: optionalNumber(input.offset),
    page_no: optionalNumber(input.page_no)
  };
  const marker = addSource(source);
  return {
    modelOutput: {
      chars_returned: result.chars_returned,
      doc_id: source.doc_id,
      kind: 'read_sciverse_content',
      marker: `[S${marker}]`,
      more: result.more,
      next_offset: result.next_offset,
      offset: source.offset ?? 0,
      text,
      truncated_for_context: text.length < result.text.length
    },
    sources: [source],
    summary: `Read ${result.chars_returned} characters from Sciverse document ${source.doc_id}.`
  };
}

export function sourceFromEvidence(evidence: ToolEvidence): ConversationSourceLink {
  return {
    entry_id: evidence.entry_id,
    entry_title: evidence.entry_title,
    page_idx: evidence.page - 1,
    quote: compactQuote(evidence.text ?? evidence.snippet ?? ''),
    segment_uid: evidence.segment_uid
  };
}

export function trimSciverseJson(value: SciverseJsonResponse, budget: number) {
  const text = JSON.stringify(value);
  const limit = Math.min(16_000, Math.floor(budget));
  if (text.length <= limit) {
    return value;
  }
  // Do not spread the original response back into a supposedly truncated result.
  // Account for JSON escaping as well as the wrapper, including quotes/newlines in schemas.
  const wrap = (length: number) => ({ _neuink_truncated: true, _neuink_preview: text.slice(0, length) });
  if (limit < JSON.stringify(wrap(0)).length) throw new Error('Sciverse context budget is too small.');
  let low = 0;
  let high = Math.min(text.length, limit);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (JSON.stringify(wrap(mid)).length <= limit) low = mid;
    else high = mid - 1;
  }
  return wrap(low);
}
