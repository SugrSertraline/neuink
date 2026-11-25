export type ArxivSearchContext = {
  schema_version: 1;
  status: 'ok' | 'partial';
  effective_query: unknown;
  search_key: unknown;
  search_plan: unknown;
  next_query: Record<string, unknown> | null;
  next_start: unknown;
  has_more: unknown;
  total_results: unknown;
  errors: unknown;
  missing_ids: unknown;
  unresolved_ids: unknown;
};

/** Only native output supplies continuation metadata; model prose never creates it. */
export function arxivSearchContext(value: unknown): ArxivSearchContext | undefined {
  if (!value || typeof value !== 'object') return;
  const output = value as Record<string, unknown>;
  if (output.schema_version !== 1 || !['ok', 'partial'].includes(String(output.status))) return;
  return {
    schema_version: 1, status: output.status as 'ok' | 'partial',
    effective_query: output.effective_query, search_key: output.search_key, search_plan: output.search_plan,
    next_query: output.next_query && typeof output.next_query === 'object' && !Array.isArray(output.next_query)
      ? output.next_query as Record<string, unknown> : null,
    next_start: output.next_start, has_more: output.has_more, total_results: output.total_results,
    errors: output.errors, missing_ids: output.missing_ids, unresolved_ids: output.unresolved_ids,
  };
}
