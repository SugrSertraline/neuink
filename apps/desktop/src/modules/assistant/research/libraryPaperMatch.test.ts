import { expect, it } from 'vitest';
import type { ResearchPaper } from '@/shared/ipc/researchApi';
import { indexLibraryPapers, type PaperLibraryEntry } from './libraryPaperMatch';

const paper: ResearchPaper = { id: 'arxiv:2401.00001v3', title: 'A Study of Diffusion Models', doi: '10.1234/AB.C',
  url: 'https://arxiv.org/abs/2401.00001v3', pdf_url: 'https://arxiv.org/pdf/2401.00001v3',
  authors: [], year: '', abstract_text: '', provider: 'arxiv', evidence_level: 'abstract' };
const entry = (fields: Record<string, string> = {}): PaperLibraryEntry => ({ id: 'local', title: 'Renamed local paper', fields,
  pdf: { file_name: 'paper.pdf', content_hash: '', imported_at: '', parse: { status: 'not_started', updated_at: '', message: null, task_id: null, endpoint: null } } });

it.each<Record<string, string>>([
  { research_id: 'arxiv:2401.00001v1' }, { arxiv_id: '2401.00001' },
  { source_url: 'http://arxiv.org/abs/2401.00001v2' },
  { pdf_source_url: 'https://export.arxiv.org/pdf/2401.00001v12.pdf?download=1' },
  { url: 'https://arxiv.org/html/2401.00001v2' },
  { doi: ' https://doi.org/10.1234/ab.c ' }, { doi: 'DOI:10.1234/AB.C' },
])('detects an existing renamed paper from its identity: %j', fields => {
  expect(indexLibraryPapers([entry(fields)])(paper)).toEqual({ entryId: 'local', hasPdf: true });
});

it('handles legacy arXiv identifiers and exact non-arXiv source URLs', () => {
  const legacy = { ...paper, id: 'arxiv:hep-th/9901001v3', url: '', pdf_url: null, doi: '' };
  expect(indexLibraryPapers([entry({ url: 'https://arxiv.org/pdf/hep-th/9901001v1.pdf' })])(legacy)?.entryId).toBe('local');
  expect(indexLibraryPapers([entry({ source_url: 'http://example.com/paper?a=1' })])({ ...paper, url: 'https://example.com/paper?a=1#abstract' })?.entryId).toBe('local');
});

it('uses a unique normalized exact title for manually imported PDFs without inventing a fuzzy match', () => {
  const manual = { ...entry(), title: '  A Study of\nDiffusion Models  ' };
  expect(indexLibraryPapers([manual])(paper)?.entryId).toBe('local');
  expect(indexLibraryPapers([manual, { ...manual, id: 'another' }])(paper)).toBeNull();
  expect(indexLibraryPapers([{ ...manual, title: 'A Study of Diffusion Models II' }])(paper)).toBeNull();
  expect(indexLibraryPapers([{ ...manual, fields: { doi: '10.5555/other' } }])(paper)).toBeNull();
  expect(indexLibraryPapers([{ ...manual, fields: { arxiv_id: '2401.99999' } }])(paper)).toBeNull();
});

it('distinguishes metadata-only entries, prefers a PDF copy and discards deleted matches on rebuild', () => {
  const metadata = { ...entry({ research_id: paper.id }), pdf: null };
  expect(indexLibraryPapers([metadata])(paper)).toEqual({ entryId: 'local', hasPdf: false });
  expect(indexLibraryPapers([metadata, { ...entry(metadata.fields), id: 'pdf-copy' }])(paper)).toEqual({ entryId: 'pdf-copy', hasPdf: true });
  expect(indexLibraryPapers([])(paper)).toBeNull();
});

it('does not match empty metadata or an arXiv-looking path on another host', () => {
  expect(indexLibraryPapers([entry()])(paper)).toBeNull();
  expect(indexLibraryPapers([entry({ url: 'https://arxiv.org.example.com/abs/2401.00001' })])(paper)).toBeNull();
  expect(indexLibraryPapers([{ ...entry(), title: '' }])({ ...paper, title: '' })).toBeNull();
});
