type Observation = { toolName: string; output: unknown };

/** A native import receipt supports an operation summary without a paper citation.
 * Content reads and explicit grounding policies still require their own evidence. */
export function hasConfirmedPaperImportOnly(observations: readonly Observation[]): boolean {
  let confirmed = false;
  for (const { toolName, output } of observations) {
    if (toolName === 'search_papers') continue;
    if (toolName !== 'import_papers' || !output || typeof output !== 'object') return false;
    const value = output as { ok?: boolean; isError?: boolean; results?: unknown[] };
    if (value.ok === false || value.isError === true || !Array.isArray(value.results) || !value.results.length) return false;
    if (!value.results.every(row => {
      if (!row || typeof row !== 'object') return false;
      const item = row as { id?: unknown; entry_id?: unknown; status?: unknown };
      return typeof item.id === 'string' && Boolean(item.id.trim())
        && typeof item.entry_id === 'string' && Boolean(item.entry_id.trim())
        && (item.status === 'imported' || item.status === 'already_in_library');
    })) return false;
    confirmed = true;
  }
  return confirmed;
}
