/** Keep identities and URLs intact while limiting untrusted excerpts sent back to the model. */
export function researchOutput(value: unknown, budget: number): unknown {
  if (!value || typeof value !== 'object') return value;
  const result = value as Record<string, unknown>;
  const field = Array.isArray(result.papers) ? 'papers' : Array.isArray(result.results) ? 'results' : null;
  if (!field) return result;
  const rows = result[field] as Record<string, unknown>[];
  const allowance = Math.max(200, Math.min(6000, Math.floor(budget / Math.max(1, rows.length)) - 1200));
  return { ...result, [field]: rows.map(row => {
    const identity = field === 'papers' && typeof row.id === 'string' ? { paper_ref: `research:${row.id}` } : {};
    const excerpt = typeof row.abstract_text === 'string' ? 'abstract_text' : typeof row.content === 'string' ? 'content' : null;
    if (!excerpt) return { ...row, ...identity };
    const text = row[excerpt] as string;
    return { ...row, ...identity, ...(Array.isArray(row.authors) ? { authors: row.authors.slice(0, 5), authors_truncated: row.authors.length > 5 } : {}),
      ...(Array.isArray(row.links) ? { links: row.links.slice(0, 6), links_truncated: row.links.length > 6 } : {}),
      [excerpt]: text.slice(0, allowance), truncated: Boolean(row.truncated) || text.length > allowance };
  }) };
}
