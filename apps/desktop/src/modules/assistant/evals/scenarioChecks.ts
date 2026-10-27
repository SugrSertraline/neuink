import { paperRecords, presentedPaperRecords } from '../research/paperPresentation';
import { matchedExternalCitationUrls } from '../sdk/citationContract';
import type { EvalRun } from './types';

/** Validate rendered recommendations as well as ordinary inline links against retrieved records. */
export function listsRecentPapers(run: EvalRun, count: number, year: number): boolean {
  const sources = (run.sourceLedgers ?? []).flatMap(ledger => ledger.sources.map(([, source]) => source));
  const records = paperRecords(run.toolEvents.flatMap(event => event.status === 'done' ? event.researchPapers ?? [] : []), sources);
  const presented = new Set(presentedPaperRecords(run.answer, records).map(record => record.ref));
  const selected = [...records.values()].filter(record => {
    const published = record.kind === 'research' ? Number(record.paper.year) : record.source.publication_year;
    if (published == null || published < year) return false;
    const urls = record.kind === 'research' ? [record.paper.url, record.paper.pdf_url]
      : [record.source.access_oa_url];
    return presented.has(record.ref) || matchedExternalCitationUrls(run.answer,
      new Set(urls.filter((url): url is string => typeof url === 'string')), records).length > 0;
  });
  return selected.length === count;
}
