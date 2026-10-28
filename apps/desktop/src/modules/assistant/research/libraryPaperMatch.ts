import type { EntryMeta } from '@/shared/types/domain';
import type { ResearchPaper } from '@/shared/ipc/researchApi';

export type PaperLibraryEntry = Pick<EntryMeta, 'id' | 'title' | 'fields' | 'pdf'>;
export type LocalPaperMatch = { entryId: string; hasPdf: boolean };

function arxivId(raw: string) {
  let value = raw.trim().toLowerCase().replace(/^arxiv:\s*/, '');
  if (/^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (!['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname)) return '';
      value = decodeURIComponent(url.pathname).replace(/^\/(?:abs|pdf|html)\//, '');
    } catch { return ''; }
  }
  value = value.replace(/\.pdf$/, '').replace(/v\d+$/, '');
  return /^(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]+\/\d{7})$/.test(value) ? value : '';
}

function doi(raw: string) {
  let value = raw.trim().replace(/^doi:\s*/i, '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  try { value = decodeURIComponent(value); } catch { return ''; }
  return /^10\.\d{4,9}\/\S+$/i.test(value) ? value.toLowerCase() : '';
}

function sourceUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.toString().replace(/^http:/, 'https:');
  } catch { return ''; }
}

const titleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function identity(id: string, doiValue: string, sources: string[]) {
  const arxiv = new Set([id, ...sources].map(arxivId).filter(Boolean));
  const dois = new Set([doiValue, id.replace(/^crossref:/, ''), ...sources].map(doi).filter(Boolean));
  return { arxiv, dois, keys: [
    ...(id.trim() ? [`id:${id.trim()}`] : []),
    ...[...arxiv].map(value => `arxiv:${value}`), ...[...dois].map(value => `doi:${value}`),
    ...sources.map(sourceUrl).filter(Boolean).map(value => `url:${value}`),
  ] };
}
const conflicts = (left: Set<string>, right: Set<string>) => left.size > 0 && right.size > 0 && ![...left].some(value => right.has(value));

/** Rebuilt from the live, unfiltered catalog; no persistent copy or network lookup. */
export function indexLibraryPapers(entries: readonly PaperLibraryEntry[]) {
  const byIdentity = new Map<string, PaperLibraryEntry[]>(), byTitle = new Map<string, PaperLibraryEntry[]>();
  const identities = new Map<string, ReturnType<typeof identity>>();
  const add = (map: Map<string, PaperLibraryEntry[]>, key: string, entry: PaperLibraryEntry) => {
    if (key) map.set(key, [...(map.get(key) ?? []), entry]);
  };
  for (const entry of entries) {
    const fields = entry.fields;
    const identifiers = identity(fields.research_id ?? '', fields.doi ?? '',
      ['arxiv_id', 'url', 'source_url', 'pdf_source_url'].map(key => fields[key] ?? ''));
    identities.set(entry.id, identifiers);
    for (const key of new Set(identifiers.keys)) add(byIdentity, key, entry);
    add(byTitle, titleKey(entry.title), entry);
  }
  return (paper: ResearchPaper): LocalPaperMatch | null => {
    const identifiers = identity(paper.id, paper.doi ?? '', [paper.url, paper.pdf_url ?? '']);
    const strong = identifiers.keys.flatMap(key => byIdentity.get(key) ?? []);
    // Prefer a readable copy if the catalog already contains duplicate identities.
    let entry = strong.find(item => item.pdf != null) ?? strong[0];
    if (!entry) {
      const sameTitle = byTitle.get(titleKey(paper.title)) ?? [];
      if (sameTitle.length !== 1) return null;
      const known = identities.get(sameTitle[0].id)!;
      if (conflicts(identifiers.arxiv, known.arxiv) || conflicts(identifiers.dois, known.dois)) return null;
      entry = sameTitle[0];
    }
    return { entryId: entry.id, hasPdf: entry.pdf != null };
  };
}
