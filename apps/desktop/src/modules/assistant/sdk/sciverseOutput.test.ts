import { describe, expect, it, vi } from 'vitest';
import type { SciverseAgenticSearchHit } from '@/modules/sciverse/types';
import { formatSciverseSearchOutput } from './sciverseOutput';
import { trimSciverseJson } from './toolSupport';
import { SourceLedger } from '../runtime/sourceLedger';

function hit(overrides: Partial<SciverseAgenticSearchHit> = {}): SciverseAgenticSearchHit {
  return { doc_id: 'doc-1', chunk_id: 'chunk-1', title: 'A paper', chunk: 'Measured result.',
    offset: 120, page_no: 2, author: ['Alice'], ...overrides };
}

function format(hits: SciverseAgenticSearchHit[], budget = 24_000) {
  const ledger = new SourceLedger();
  const add = vi.fn(ledger.add.bind(ledger));
  return { ...formatSciverseSearchOutput({ hits }, add, 'time series', budget), ledger, add };
}

describe('Sciverse structured retrieval adapter', () => {
  it('deduplicates exact hits, groups a document once and preserves each remaining citation', () => {
    const a = hit();
    const result = format([a, { ...a }, hit({ chunk_id: 'chunk-2', offset: 300, chunk: 'Another result.' })]);
    expect(result.modelOutput.papers).toHaveLength(1);
    expect(result.modelOutput.evidence).toHaveLength(2);
    expect(result.modelOutput.counts).toMatchObject({ received_hits: 3, duplicate_hits: 1, unique_documents: 1, omitted_evidence: 0 });
    expect(result.modelOutput.truncated).toBe(false);
    expect(result.add).toHaveBeenCalledTimes(2);
    expect(result.modelOutput.evidence.map(row => row.marker)).toEqual(['[S1]', '[S2]']);
    expect(result.ledger.sources.get(2)).toMatchObject({ doc_id: 'doc-1', chunk_id: 'chunk-2', offset: 300 });
  });

  it('cleans metadata/excerpts without changing source offsets, quotes or import identifiers', () => {
    const chunk = 'A result ![](dt=2026/image.jpg) and ![]\\(ocr.jpg) $x^2$\n remains.';
    const original = hit({ chunk, page_no: 0, author: [' Alice ', 'alice', '', 'Bob  Smith'],
      doi: ' HTTPS://doi.org/10.1234/ABC ', file_name: 'remote/paper.pdf', access_oa_url: 'https://example.org/a.pdf' });
    const snapshot = structuredClone(original);
    const result = format([original]);
    expect(result.modelOutput.papers[0]).toMatchObject({ authors: ['Alice', 'Bob Smith'], doi: '10.1234/abc' });
    expect(result.modelOutput.evidence[0]).toMatchObject({ snippet: 'A result and $x^2$ remains.', page_no: null, offset: 120 });
    expect(result.sources[0]).toMatchObject({ page_no: 0, quote: chunk.replace(/\s+/g, ' '),
      resource_file_name: 'remote/paper.pdf', access_oa_url: 'https://example.org/a.pdf' });
    expect(original).toEqual(snapshot);
  });

  it.each([null, undefined, -1, 0, 1.5])('treats ambiguous page %s as unknown without manufacturing a location', page_no => {
    expect(format([hit({ page_no })]).modelOutput.evidence[0].page_no).toBeNull();
  });

  it('does not merge different documents or preprint/publication versions even with matching DOI/title', () => {
    const result = format([
      hit({ doi: '10.1234/same', publication_published_year: 2019, publication_venue_name_unified: 'arXiv' }),
      hit({ doc_id: 'doc-2', doi: 'https://doi.org/10.1234/same', publication_published_year: 2020, publication_venue_name_unified: 'AAAI' })
    ]);
    expect(result.modelOutput.papers.map(paper => [paper.publication_year, paper.venue])).toEqual([[2019, 'arXiv'], [2020, 'AAAI']]);
    expect(result.modelOutput.evidence.map(row => row.marker)).toEqual(['[S1]', '[S2]']);
  });

  it('preserves identical text at distinct locations', () => {
    const result = format([hit(), hit({ chunk_id: 'chunk-2', offset: 900, page_no: 4 })]);
    expect(result.modelOutput.evidence).toHaveLength(2);
    expect(result.modelOutput.counts.duplicate_hits).toBe(0);
  });

  it('gives other documents a chance before filling the evidence limit with one paper', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => hit({ chunk_id: `chunk-${i}`, offset: i }));
    const result = format([...chunks, hit({ doc_id: 'doc-2' })]);
    expect(result.modelOutput.evidence[1].doc_id).toBe('doc-2');
    expect(result.modelOutput.evidence).toHaveLength(12);
    expect(result.modelOutput.counts.omitted_evidence).toBe(9);
    expect(result.modelOutput.truncated).toBe(true);
    expect(result.add).toHaveBeenCalledTimes(12);
  });

  it.each([1024, 2000, 6000, 24_000, 100_000])('bounds the entire escaped model JSON at budget %i', budget => {
    const result = format(Array.from({ length: 20 }, (_, i) => hit({
      doc_id: `doc-${i}`, chunk: '\\"\n中文'.repeat(4000), abstract: 'long '.repeat(3000),
      author: Array.from({ length: 20 }, (_, j) => `Author${j}`)
    })), budget);
    expect(JSON.stringify(result.modelOutput).length).toBeLessThanOrEqual(Math.min(budget, 24_000));
    expect(result.modelOutput.truncated).toBe(true);
    expect(result.add).toHaveBeenCalledTimes(result.modelOutput.evidence.length);
    expect(result.sources).toHaveLength(result.modelOutput.evidence.length);
    expect(result.modelOutput.counts.omitted_evidence + result.modelOutput.evidence.length).toBe(20);
  });

  it('handles empty or invalid records without orphan citations', () => {
    const empty = format([]);
    expect(empty.modelOutput.papers).toEqual([]);
    expect(empty.modelOutput.truncated).toBe(false);
    const invalid = format([hit({ doc_id: '' }), hit({ chunk: null as never })]);
    expect(invalid.modelOutput.counts.invalid_hits).toBe(2);
    expect(invalid.add).not.toHaveBeenCalled();
  });

  it('omits oversized identifiers intact instead of inventing truncated document ids', () => {
    const result = format([hit({ doc_id: 'x'.repeat(30_000) }), hit({ doc_id: 'valid' })], 2000);
    expect(result.modelOutput.evidence.map(row => row.doc_id)).toEqual(['valid']);
    expect(result.modelOutput.counts.omitted_evidence).toBe(1);
    expect(result.add).toHaveBeenCalledTimes(1);
  });

  it('does not silently expand an unusable context budget', () => {
    expect(() => format([hit()], 100)).toThrow(/budget/);
  });
});

describe('Sciverse metadata/schema output bounds', () => {
  it('keeps small structured responses intact', () => {
    const value = { fields: ['doi'], results: [{ title: 'Paper' }] };
    expect(trimSciverseJson(value, 2000)).toBe(value);
  });
  it('does not retain a huge raw payload beside its preview', () => {
    const value = { results: [{ title: '\\"\n'.repeat(20_000) }] };
    const result = trimSciverseJson(value, 2000);
    expect(result).not.toHaveProperty('results');
    expect(result).toHaveProperty('_neuink_truncated', true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2000);
  });
});
