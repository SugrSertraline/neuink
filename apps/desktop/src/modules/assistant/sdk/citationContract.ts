type Observation = { toolName: string; output: unknown };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function citationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = '';
    return url.href;
  } catch { return; }
}

/** External readers cite their returned URLs, not invented local [S#] markers.
 * Only known result metadata counts; never harvest links embedded in untrusted body text. */
export function returnedExternalCitationUrls(observations: readonly Observation[]): Set<string> {
  const urls = new Set<string>();
  const add = (value: unknown) => { const url = citationUrl(value); if (url) urls.add(url); };
  for (const observation of observations) {
    const output = object(observation.output);
    if (output.ok === false || output.isError === true) continue;
    if (observation.toolName === 'read_browser_tab') {
      if (output.status === 'read' && typeof output.text === 'string' && output.text.trim()) add(output.url);
    } else if (observation.toolName === 'read_webpage' || observation.toolName === 'search_web') {
      for (const row of Array.isArray(output.results) ? output.results.slice(0, 100) : []) {
        const result = object(row);
        if (typeof result.content === 'string' && result.content.trim()) add(result.url);
      }
    } else if (observation.toolName === 'search_papers') {
      for (const row of Array.isArray(output.papers) ? output.papers.slice(0, 100) : []) {
        const paper = object(row);
        if (typeof paper.title === 'string' && paper.title.trim()) { add(paper.url); add(paper.pdf_url); }
      }
    }
  }
  return urls;
}

export function hasReturnedExternalCitation(answer: string, urls: ReadonlySet<string>): boolean {
  return [...answer.matchAll(/https?:\/\/[^\s<>()[\]]+/g)].some(match => {
    const url = citationUrl(match[0].replace(/[.,;!?]+$/, ''));
    return Boolean(url && urls.has(url));
  });
}

export function citationCorrection(markers: Iterable<number>, hasExternalSources: boolean): string {
  const available = [...markers];
  return [
    available.length ? `The only valid local citation markers are: ${available.map(marker => `[S${marker}]`).join(', ')}. Never invent other markers.`
      : 'This run has NO [S#] citation markers. Remove every invented [S#] reference; do not create or guess marker numbers.',
    hasExternalSources
      ? 'External webpage, browser and paper-search evidence uses the exact URLs returned by those tools. Cite those URLs inline in Markdown instead of assigning local [S#] markers. A URL citation does not turn metadata, a snippet or partial pages into full-text evidence.'
      : 'Use only evidence obtained in this run. If no usable evidence was acquired, give an honest limitation answer without fabricated citations or unsupported document claims.',
  ].join('\n');
}
