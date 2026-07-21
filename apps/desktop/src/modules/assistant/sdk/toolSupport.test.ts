import { describe, expect, it } from 'vitest';

import {
  formatSciverseSearchOutput,
  applyMarkdownPatchPreview,
  markdownPatchOperations,
  noteProposalAction,
  noteProposalInputSchema,
  normalizeToolInput,
  prependMarkdownPreview,
  sourcesFromMarkers
} from './toolSupport';

describe('prepend note proposals', () => {
  it('accepts prepend as a model-visible proposal action', () => {
    const schema = noteProposalInputSchema();
    const action = schema.properties?.action as { enum?: unknown[] };

    expect(action.enum).toContain('prepend');
    expect(noteProposalAction('prepend', {
      currentNote: null,
      hasPlannedMarkdownNote: true,
      targetKind: 'markdown_note'
    })).toBe('prepend');
  });

  it('places generated Markdown before the existing note', () => {
    expect(prependMarkdownPreview('# Existing\n\nBody\n', '# New\n')).toBe(
      '# New\n\n# Existing\n\nBody\n'
    );
  });
});

describe('line-precise Markdown patches', () => {
  it('replaces, inserts, and deletes only the addressed logical lines', () => {
    const replaced = applyMarkdownPatchPreview('# Title\nfirst\nsecond\nlast\n', [{
      endLine: 3,
      expectedText: 'first\nsecond',
      newText: 'updated',
      startLine: 2,
      type: 'replace_lines'
    }]);
    expect(replaced).toBe('# Title\nupdated\nlast\n');

    const inserted = applyMarkdownPatchPreview(replaced, [{
      expectedText: 'updated', line: 2, position: 'after', text: 'added', type: 'insert_lines'
    }]);
    expect(inserted).toBe('# Title\nupdated\nadded\nlast\n');

    expect(applyMarkdownPatchPreview(inserted, [{
      endLine: 3, expectedText: 'added', startLine: 3, type: 'delete_lines'
    }])).toBe('# Title\nupdated\nlast\n');
  });

  it('rejects a stale expected line before preview or apply', () => {
    expect(() => applyMarkdownPatchPreview('# Title\nchanged\n', [{
      endLine: 2, expectedText: 'old', startLine: 2, type: 'delete_lines'
    }])).toThrow(/expected_text/);
  });

  it('parses model line coordinates into the typed patch contract', () => {
    expect(markdownPatchOperations([{
      end_line: 4,
      expected_text: 'old',
      new_text: 'new',
      start_line: 4,
      type: 'replace_lines'
    }])).toEqual([{
      endLine: 4,
      expectedText: 'old',
      newText: 'new',
      startLine: 4,
      type: 'replace_lines'
    }]);
  });
});

describe('Sciverse assistant tools', () => {
  it('normalizes bounded search input and preserves remote source identifiers', () => {
    expect(normalizeToolInput('search_sciverse_evidence', {
      query: 'graphene battery',
      sub_queries: 99,
      top_k: 99
    }, {
      root: 'workspace',
      scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }
    })).toEqual({
      query: 'graphene battery',
      sub_queries: 4,
      top_k: 20
    });

    const sources: unknown[] = [];
    const formatted = formatSciverseSearchOutput({
      hits: [{
        chunk: 'Measured cycle stability improved after 500 cycles.',
        chunk_id: 'chunk-7',
        doc_id: 'doc-42',
        doi: '10.1000/example',
        access_is_oa: true,
        access_oa_url: 'https://example.com/paper.pdf',
        author: ['A. Author'],
        file_name: 'papers/doc-42.pdf',
        offset: 1200,
        page_no: 8,
        publication_published_year: 2026,
        publication_venue_name_unified: 'Example Journal',
        score: 0.91,
        title: 'Graphene Battery Study'
      }]
    }, (source) => {
      sources.push(source);
      return sources.length;
    }, 'graphene battery');

    expect(formatted.modelOutput.evidence[0]).toMatchObject({
      doc_id: 'doc-42',
      marker: '[S1]',
      page_no: 8
    });
    expect(sources[0]).toMatchObject({
      provider: 'sciverse',
      doc_id: 'doc-42',
      chunk_id: 'chunk-7',
      authors: ['A. Author'],
      publication_year: 2026,
      access_oa_url: 'https://example.com/paper.pdf',
      resource_file_name: 'papers/doc-42.pdf'
    });
  });

  it('does not convert remote citations into local workspace note links', () => {
    const sources = sourcesFromMarkers(['S1', 'S2'], new Map([
      [1, {
        provider: 'sciverse' as const,
        doc_id: 'doc-42',
        title: 'Remote paper',
        quote: 'Remote evidence'
      }],
      [2, {
        entry_id: 'entry-1',
        entry_title: 'Local paper',
        page_idx: 2,
        quote: 'Local evidence',
        segment_uid: 'segment-3'
      }]
    ]));

    expect(sources).toEqual([{
      entryId: 'entry-1',
      entryTitle: 'Local paper',
      marker: 'S2',
      pageIdx: 2,
      quote: 'Local evidence',
      segmentUid: 'segment-3'
    }]);
  });

  it('bounds structured metadata and Paper Schema search inputs', () => {
    const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
    expect(normalizeToolInput('search_sciverse_metadata', {
      fields: ['title', 42, 'doi'], page: 0, page_size: 99, query: 'retrieval augmented generation'
    }, { root: 'workspace', scope })).toEqual({
      fields: ['title', 'doi'], page: 1, page_size: 20, query: 'retrieval augmented generation'
    });
    expect(normalizeToolInput('search_sciverse_paper_schema', {
      page: 999, page_size: 0, query: 'benchmark'
    }, { root: 'workspace', scope })).toEqual({ page: 100, page_size: 1, query: 'benchmark' });
    expect(normalizeToolInput('get_sciverse_metadata_catalog', {}, { root: 'workspace', scope })).toEqual({});
  });
});
