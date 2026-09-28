import type { SciverseAgenticSearchHit, SciverseAgenticSearchResponse } from '@/modules/sciverse/types';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';

const MAX_EVIDENCE = 12;
const MAX_OUTPUT_CHARS = 24_000;
const RESERVED_MARKER = '[S9007199254740991]';

/** Normalize presentation text only. Never use cleaned text to calculate source offsets. */
function cleanText(value: string | null | undefined) {
  return (value ?? '').replace(/!\[[^\]\n]*\]\\?\([^\n)]*\)/g, ' ')
    .replace(/\s+/gu, ' ').trim();
}

function uniqueAuthors(authors: string[] = []) {
  const seen = new Set<string>();
  return authors.map(cleanText).filter(author => {
    const key = author.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedDoi(value: string | null | undefined) {
  const doi = (value ?? '').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi.toLowerCase() : null;
}

function prepare(hit: SciverseAgenticSearchHit, textLimit: number) {
  let truncated = false;
  const limit = (value: string | null | undefined, max: number) => {
    const text = cleanText(value);
    truncated ||= text.length > max;
    return text.slice(0, max);
  };
  const authors = uniqueAuthors(hit.author);
  truncated ||= authors.length > 12;
  const paper = {
    paper_ref: `sciverse:${hit.doc_id}`,
    doc_id: hit.doc_id,
    title: limit(hit.title, 400) || 'Sciverse document',
    authors: authors.slice(0, 12).map(author => limit(author, 120)),
    abstract: limit(hit.abstract, textLimit),
    publication_year: Number.isInteger(hit.publication_published_year) && hit.publication_published_year! > 0
      ? hit.publication_published_year : null,
    venue: limit(hit.publication_venue_name_unified, 200),
    doi: normalizedDoi(hit.doi),
    citation_count: Number.isInteger(hit.citation_count) && hit.citation_count! >= 0 ? hit.citation_count : null,
    primary_topic: limit(hit.primary_topic, 200),
    access_is_oa: hit.access_is_oa,
    access_oa_url: hit.access_oa_url,
    source_type: limit(hit.source_type, 80),
    metadata_truncated: false
  };
  paper.metadata_truncated = truncated;
  const snippet = limit(hit.chunk, textLimit);
  const evidence = {
    doc_id: hit.doc_id, chunk_id: hit.chunk_id, marker: RESERVED_MARKER,
    offset: hit.offset,
    page_no: Number.isInteger(hit.page_no) && hit.page_no! > 0 ? hit.page_no : null,
    snippet, truncated
  };
  // Retain original remote coordinates and import metadata, separately from model-facing excerpts.
  const source: ConversationSourceLink = {
    provider: 'sciverse', doc_id: hit.doc_id, chunk_id: hit.chunk_id,
    title: cleanText(hit.title) || 'Sciverse document',
    quote: hit.chunk.replace(/\s+/gu, ' ').trim().slice(0, 240),
    offset: hit.offset, page_no: hit.page_no, score: hit.score,
    abstract: hit.abstract, authors, publication_year: hit.publication_published_year,
    venue: hit.publication_venue_name_unified, citation_count: hit.citation_count,
    primary_topic: hit.primary_topic, doi: hit.doi, access_is_oa: hit.access_is_oa,
    access_oa_url: hit.access_oa_url, access_license: hit.access_license,
    source_type: hit.source_type, resource_file_name: hit.file_name
  };
  return { paper, evidence, source };
}

/** Deterministic retrieval adapter, not another model/agent. No inference of paper identity or venue. */
export function formatSciverseSearchOutput(
  result: SciverseAgenticSearchResponse,
  addSource: (source: ConversationSourceLink) => number,
  query: string,
  contextBudget = MAX_OUTPUT_CHARS
) {
  if (!Number.isFinite(contextBudget) || contextBudget < 1024) {
    throw new Error('Sciverse output requires at least 1024 characters of context budget.');
  }
  const budget = Math.min(MAX_OUTPUT_CHARS, Math.floor(contextBudget));
  const hits = result.hits ?? [];
  const groups = new Map<string, SciverseAgenticSearchHit[]>();
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const hit of hits) {
    if (!hit.doc_id?.trim() || typeof hit.chunk !== 'string') { invalid++; continue; }
    // Only exact repeated evidence is discarded. Different locations, text or versions survive.
    const key = JSON.stringify([hit.doc_id, hit.chunk_id ?? null, hit.offset ?? null, hit.page_no ?? null, hit.chunk]);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    const group = groups.get(hit.doc_id) ?? [];
    group.push(hit);
    groups.set(hit.doc_id, group);
  }
  // Give each document a chance before spending the budget on more chunks of the first paper.
  const candidates: SciverseAgenticSearchHit[] = [];
  for (let index = 0; candidates.length < Math.min(MAX_EVIDENCE, seen.size); index++) {
    for (const group of groups.values()) {
      if (group[index]) candidates.push(group[index]);
      if (candidates.length === MAX_EVIDENCE) break;
    }
  }
  type Prepared = ReturnType<typeof prepare>;
  const selected: Prepared[] = [];
  const queryText = cleanText(query).slice(0, 160);
  const output = (rows: Prepared[]) => {
    const documents = new Map<string, Prepared['paper']>();
    for (const row of rows) {
      if (!documents.has(row.paper.doc_id)) documents.set(row.paper.doc_id, row.paper);
    }
    const papers = [...documents.values()];
    return {
      kind: 'search_sciverse_evidence', source: 'sciverse', query: queryText,
      papers, evidence: rows.map(row => row.evidence),
      counts: {
        received_hits: hits.length, duplicate_hits: duplicates, invalid_hits: invalid,
        unique_documents: groups.size, returned_documents: papers.length,
        returned_evidence: rows.length, omitted_evidence: seen.size - rows.length
      },
      truncated: rows.length < seen.size || queryText !== cleanText(query) || rows.some(row => row.evidence.truncated)
    };
  };
  const textLimit = Math.min(1600, Math.max(160, Math.floor(budget / Math.max(1, candidates.length) / 3)));
  for (const hit of candidates) {
    let row = prepare(hit, textLimit);
    if (JSON.stringify(output([...selected, row])).length > budget) {
      row = prepare(hit, 160);
      if (JSON.stringify(output([...selected, row])).length > budget) continue;
    }
    selected.push(row);
  }
  // Register only evidence actually sent to the model; dropped candidates cannot create orphan citations.
  for (const row of selected) row.evidence.marker = `[S${addSource(row.source)}]`;
  const modelOutput = output(selected);
  return {
    modelOutput, sources: selected.map(row => row.source),
    summary: `Sciverse: ${modelOutput.counts.returned_documents} documents, ${selected.length} evidence chunks; `
      + `${duplicates} duplicates removed, ${modelOutput.counts.omitted_evidence} omitted${modelOutput.truncated ? ' (truncated)' : ''}.`
  };
}
