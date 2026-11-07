import type {
  AssistantToolDescriptor,
  ReadEntryAssistantContextResponse,
  ReadSegmentContentResponse
} from '@/shared/ipc/assistantApi';
import type { SearchResults } from '@/shared/ipc/workspaceApi';
import type { FixtureHandler, PdfFixture } from './types';

/**
 * Deterministic host fixtures. These stand in for the Rust/Tauri tool backends so the
 * evaluation observes only the agent's decisions, never a real workspace or network.
 */

export const ENTRIES = {
  attention: { id: 'paper-attn', title: 'Attention Is All You Need' },
  diffusion: { id: 'paper-diffusion', title: 'Diffusion Models Beat GANs on Image Synthesis' },
  scanned: { id: 'paper-scanned', title: 'Scanned Longitudinal Study (text layer only)' }
} as const;

export type LibrarySegment = {
  entryId: string;
  entryTitle: string;
  segmentUid: string;
  pageIdx: number;
  snippet: string;
  text: string;
  keywords: string[];
};

export const SEGMENTS: LibrarySegment[] = [
  {
    entryId: ENTRIES.attention.id,
    entryTitle: ENTRIES.attention.title,
    segmentUid: 'attn-method',
    pageIdx: 2,
    snippet: 'The Transformer uses multi-head attention with 8 heads; each head has dimension 64.',
    text:
      'The Transformer uses multi-head attention with 8 heads; each head has dimension 64. ' +
      'The encoder and decoder are each composed of six identical layers.',
    keywords: ['attention', 'head', 'multi-head', 'heads', 'encoder', 'decoder', 'mechanism']
  },
  {
    entryId: ENTRIES.attention.id,
    entryTitle: ENTRIES.attention.title,
    segmentUid: 'attn-ffn',
    pageIdx: 2,
    snippet:
      'Each layer contains a position-wise feed-forward network: two linear transformations ' +
      'with a ReLU in between, applied identically to every position.',
    text:
      'Each layer contains a position-wise feed-forward network: two linear transformations ' +
      'with a ReLU in between, applied identically to every position. The inner layer has ' +
      'dimension 2048 and the outer layer has dimension 512.',
    keywords: ['feed', 'forward', 'network', 'relu', 'linear', 'position-wise', 'layer']
  },
  {
    entryId: ENTRIES.attention.id,
    entryTitle: ENTRIES.attention.title,
    segmentUid: 'attn-results',
    pageIdx: 6,
    snippet:
      'On WMT 2014 English-to-German translation, the big Transformer model achieves 28.4 BLEU, ' +
      '2.0 BLEU above the previous best published result.',
    text:
      'On WMT 2014 English-to-German translation, the big Transformer model achieves 28.4 BLEU, ' +
      '2.0 BLEU above the previous best published result. The big model was trained for 3.5 days ' +
      'on 8 P100 GPUs.',
    keywords: ['bleu', 'wmt', 'english', 'german', 'translation', 'result', 'big']
  },
  {
    entryId: ENTRIES.attention.id,
    entryTitle: ENTRIES.attention.title,
    segmentUid: 'attn-results-appendix',
    pageIdx: 11,
    snippet:
      'Appendix Table 9 reports 27.3 BLEU for the big model on WMT 2014 English-to-German ' +
      'under a different tokenization.',
    text:
      'Appendix Table 9 reports 27.3 BLEU for the big model on WMT 2014 English-to-German ' +
      'under a different tokenization. This number is not directly comparable to the main ' +
      'table because the tokenizer was changed.',
    keywords: ['appendix', 'table', '27.3', 'bleu', 'tokenization', 'wmt']
  },
  {
    entryId: ENTRIES.attention.id,
    entryTitle: ENTRIES.attention.title,
    segmentUid: 'attn-ablation',
    pageIdx: 7,
    snippet:
      'Ablation study: removing positional encoding measurably reduces translation quality; ' +
      'the drop is reported in Table 3.',
    text:
      'Ablation study: removing positional encoding measurably reduces translation quality; ' +
      'the drop is reported in Table 3. Concretely, removing positional encoding reduces BLEU ' +
      'by 1.2 on the development set compared with the base model.',
    keywords: ['ablation', 'positional', 'encoding', 'position', 'table', 'drop', 'quality']
  },
  {
    entryId: ENTRIES.diffusion.id,
    entryTitle: ENTRIES.diffusion.title,
    segmentUid: 'diff-fid',
    pageIdx: 4,
    snippet:
      'Our diffusion model achieves an FID of 3.85 on ImageNet 256x256, improving on the previous ' +
      'state of the art.',
    text:
      'Our diffusion model achieves an FID of 3.85 on ImageNet 256x256, improving on the previous ' +
      'state of the art. We also report improved precision and recall under the same evaluation protocol.',
    keywords: ['fid', 'imagenet', '256', 'image', 'diffusion', 'sample', 'state']
  }
];

/** Every advertised PDF has a consistent text-layer backend, including alternative tool routes. */
export function defaultPdfFixtures(): Record<string, PdfFixture> {
  return Object.fromEntries(Object.values(ENTRIES).map(entry => {
    const segments = SEGMENTS.filter(segment => segment.entryId === entry.id);
    const pageCount = Math.max(1, ...segments.map(segment => segment.pageIdx + 1));
    return [entry.id, { revision: 'abcdef12', pageCount, pages: Array.from({ length: pageCount }, (_, pageIdx) => ({
      page_idx: pageIdx,
      text: segments.filter(segment => segment.pageIdx === pageIdx).map(segment => segment.text).join('\n\n') ||
        'This synthetic page contains no additional experimental results.',
      truncated: false
    })) }];
  }));
}

/** Mirror of the Rust `list_tools` descriptors (PDF descriptors are added by the SDK). */
export const ASSISTANT_TOOL_DESCRIPTORS: AssistantToolDescriptor[] = [
  {
    name: 'search_segments',
    description:
      'Search parsed PDF source segments within an optional Entry scope. Hybrid mode is preferred ' +
      'and falls back to keyword until local embedding resources are bundled.',
    parameters_schema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        query: { type: 'string' },
        scope_entry_ids: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['keyword', 'semantic', 'hybrid'] },
        top_k: { type: 'number' }
      },
      required: ['root', 'query']
    }
  },
  {
    name: 'read_segment_content',
    description: 'Read the full text and page for one PDF source segment.',
    parameters_schema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        entry_id: { type: 'string' },
        segment_uid: { type: 'string' }
      },
      required: ['root', 'entry_id', 'segment_uid']
    }
  },
  {
    name: 'read_entry_assistant_context',
    description: 'Read parsed PDF segments for one Entry as assistant-ready markdown.',
    parameters_schema: {
      type: 'object',
      properties: { root: { type: 'string' }, entry_id: { type: 'string' } },
      required: ['root', 'entry_id']
    }
  },
  {
    name: 'search_sciverse_evidence',
    description:
      "Search Sciverse's remote scientific literature index for citable evidence chunks. Use this " +
      'for external literature discovery, not for files already in the Neuink workspace.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 4096 },
        top_k: { type: 'integer', minimum: 1, maximum: 20 },
        sub_queries: { type: 'integer', minimum: 0, maximum: 4 }
      },
      required: ['query']
    }
  },
  {
    name: 'search_sciverse_metadata',
    description:
      "Search Sciverse's structured paper metadata. Use this for bibliographic filtering, identifiers, " +
      'venues, authors, and citation metadata; it never writes to the local library.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 4096 },
        fields: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        page: { type: 'integer', minimum: 1, maximum: 100 },
        page_size: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    name: 'get_sciverse_metadata_catalog',
    description:
      'Get the live Sciverse metadata field catalog before constructing unusual structured metadata requests. This is read-only.',
    parameters_schema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'search_sciverse_paper_schema',
    description:
      'Search Sciverse Paper Schema definitions and structured research concepts. Use it to clarify ' +
      'available schema fields or domain concepts; this is read-only.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 4096 },
        page: { type: 'integer', minimum: 1, maximum: 100 },
        page_size: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    name: 'get_sciverse_paper_schema',
    description:
      'Get the Sciverse Paper Schema document. This is read-only and should be used only when the ' +
      'schema definition itself is needed.',
    parameters_schema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'read_sciverse_content',
    description:
      'Read a bounded text range from a Sciverse document by doc_id. Use this after ' +
      'search_sciverse_evidence when the returned chunk needs surrounding context.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        doc_id: { type: 'string', minLength: 1 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 100, maximum: 12000 },
        title: { type: 'string' },
        chunk_id: { type: 'string' },
        page_no: { type: 'integer', minimum: 0 }
      },
      required: ['doc_id']
    }
  },
  {
    name: 'search_papers',
    description:
      'Search real paper metadata and abstracts without API keys. Default all searches arXiv and ' +
      'Crossref; OpenAlex is optional and may rate-limit anonymous requests. Not full text. ' +
      'Prefer short English academic queries; use arxiv for public preprint PDFs.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 1000 },
        source: { type: 'string', enum: ['all', 'arxiv', 'crossref', 'openalex'] },
        limit: { type: 'integer', minimum: 1, maximum: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'import_papers',
    description:
      "Download selected papers' public PDFs and add them to the current library ONLY after explicit " +
      'user approval. Use IDs returned by search_papers.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paper_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 10,
          uniqueItems: true
        }
      },
      required: ['paper_ids']
    }
  },
  {
    name: 'search_web',
    description:
      'Search the public web. Results are snippets, not full text. Cite returned URLs.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', maxLength: 1000 } },
      required: ['query']
    }
  },
  {
    name: 'read_webpage',
    description:
      'Read a public HTTPS page. Never send private URLs, login tokens or workspace content.',
    parameters_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { url: { type: 'string', maxLength: 4096 } },
      required: ['url']
    }
  }
];

function keywords(query: string) {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 2);
}

function scoreSegment(segment: LibrarySegment, query: string) {
  const text = `${segment.snippet} ${segment.text}`.toLowerCase();
  const tokens = keywords(query);
  let score = 0;
  for (const keyword of segment.keywords) {
    if (query.toLowerCase().includes(keyword)) score += 4;
  }
  for (const token of tokens) {
    if (segment.keywords.some(keyword => keyword.includes(token) || token.includes(keyword))) score += 2;
    else if (text.includes(token)) score += 1;
  }
  return score;
}

export function entryById(entryId: string) {
  return Object.values(ENTRIES).find(entry => entry.id === entryId);
}

export function segmentsForEntry(entryId: string) {
  return SEGMENTS.filter(segment => segment.entryId === entryId);
}

/** Deterministic `search_segments` output. Falls back to a small sample so phrasing never dead-ends. */
export function segmentSearchResults(query: string, entryIds: string[]): SearchResults {
  const allowed = new Set(entryIds.length ? entryIds : Object.values(ENTRIES).map(entry => entry.id));
  const candidates = SEGMENTS.filter(segment => allowed.has(segment.entryId));
  const ranked = candidates
    .map(segment => ({ segment, score: scoreSegment(segment, query) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const selected = ranked.length
    ? ranked.slice(0, 4).map(row => row.segment)
    : candidates.slice(0, 2);
  const groups = new Map<string, LibrarySegment[]>();
  for (const segment of selected) {
    const group = groups.get(segment.entryId) ?? [];
    group.push(segment);
    groups.set(segment.entryId, group);
  }
  const entries = [...groups.values()].map(group => {
    const first = group[0];
    return {
      entry_id: first.entryId,
      entry_title: first.entryTitle,
      hit_count: group.length,
      max_score: 0.9,
      hits: group.map((segment, index) => ({
        entry_id: segment.entryId,
        entry_title: segment.entryTitle,
        source: {
          kind: 'segment' as const,
          label: 'Parsed text',
          field_name: null,
          tag_id: null,
          note_id: null,
          segment_uid: segment.segmentUid,
          page_idx: segment.pageIdx
        },
        target: {
          kind: 'segment' as const,
          entry_id: segment.entryId,
          segment_uid: segment.segmentUid,
          page_idx: segment.pageIdx
        },
        title: segment.entryTitle,
        snippet: segment.snippet,
        score: Math.max(0.1, 0.9 - index * 0.1),
        matched_terms: keywords(query).slice(0, 4)
      }))
    };
  });
  return {
    query,
    mode: 'hybrid',
    index_generation: 1,
    total_hit_count: entries.reduce((total, group) => total + group.hits.length, 0),
    entries
  };
}

export function segmentReadResult(segmentUid: string): ReadSegmentContentResponse {
  const segment = SEGMENTS.find(row => row.segmentUid === segmentUid);
  if (!segment) throw new Error(`Unknown synthetic segment: ${segmentUid}`);
  return {
    entry_id: segment.entryId,
    entry_title: segment.entryTitle,
    segment_uid: segment.segmentUid,
    page_idx: segment.pageIdx,
    text: segment.text
  };
}

export function entryReadResult(entryId: string): ReadEntryAssistantContextResponse {
  const entry = entryById(entryId);
  if (!entry) throw new Error(`Unknown synthetic entry: ${entryId}`);
  const segments = segmentsForEntry(entryId);
  const markdown = segments
    .map(
      (segment, index) =>
        `[S${index + 1}] segment_uid: ${segment.segmentUid}\n${segment.pageIdx + 1} 页\n${segment.text}`
    )
    .join('\n\n');
  return {
    entry_id: entry.id,
    entry_title: entry.title,
    has_pdf: true,
    parsed_segment_count: segments.length,
    markdown,
    sources: segments.map(segment => ({
      entry_id: segment.entryId,
      entry_title: segment.entryTitle,
      segment_uid: segment.segmentUid,
      page_idx: segment.pageIdx,
      quote: segment.snippet
    }))
  };
}

export const SYNTHETIC_PAPERS = [
  {
    id: '2401.00001',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: ['Ada Example', 'Bo Example'],
    year: '2023',
    abstract_text:
      'We study retrieval-augmented generation and report improved factual accuracy on three ' +
      'knowledge-intensive benchmarks.',
    doi: '10.1000/example.001',
    url: 'https://arxiv.org/abs/2401.00001',
    pdf_url: 'https://arxiv.org/pdf/2401.00001',
    provider: 'arxiv',
    evidence_level: 'metadata'
  },
  {
    id: '2401.00002',
    title: 'Efficient Retrieval Augmentation with Sparse Indexes',
    authors: ['Cai Example'],
    year: '2024',
    abstract_text: 'We introduce a sparse index that cuts retrieval latency while preserving answer quality.',
    doi: '10.1000/example.002',
    url: 'https://arxiv.org/abs/2401.00002',
    pdf_url: 'https://arxiv.org/pdf/2401.00002',
    provider: 'arxiv',
    evidence_level: 'metadata'
  },
  {
    id: '2401.00003',
    title: 'Evaluating Faithfulness in Retrieval-Augmented Systems',
    authors: ['Dee Example', 'Eli Example'],
    year: '2024',
    abstract_text: 'We propose a faithfulness benchmark for retrieval-augmented generation systems.',
    doi: '10.1000/example.003',
    url: 'https://arxiv.org/abs/2401.00003',
    pdf_url: null,
    provider: 'crossref',
    evidence_level: 'metadata'
  }
];

export function defaultInvokeHandlers(): Record<string, FixtureHandler> {
  return {
    search_segments: input => {
      const requested = Array.isArray(input.scope_entry_ids)
        ? input.scope_entry_ids.filter((value): value is string => typeof value === 'string')
        : [];
      return segmentSearchResults(String(input.query ?? ''), requested);
    },
    read_segment_content: input => segmentReadResult(String(input.segment_uid ?? '')),
    read_entry_assistant_context: input => entryReadResult(String(input.entry_id ?? '')),
    search_sciverse_evidence: () => ({
      hits: [
        {
          chunk:
            'Retrieval-augmented generation improved answer faithfulness by 18% on a held-out ' +
            'question-answering benchmark, while adding 40 ms of retrieval latency.',
          chunk_id: 'chunk-1',
          doc_id: 'scv-rag-001',
          offset: 0,
          page_no: 3,
          title: 'A Controlled Study of Retrieval-Augmented Generation',
          abstract:
            'We compare retrieval-augmented generation with parametric-only baselines on a ' +
            'held-out question-answering benchmark.',
          author: ['Fay Example', 'Gus Example'],
          publication_published_year: 2024,
          publication_venue_name_unified: 'Synthetic NLP Conference',
          doi: '10.1000/scv.001',
          citation_count: 17,
          primary_topic: 'Natural Language Processing',
          access_is_oa: true,
          access_oa_url: 'https://example.org/scv-rag-001.pdf',
          source_type: 'journal_article',
          score: 0.93
        }
      ],
      counts: { returned: 1, total: 1 },
      query: 'retrieval augmented generation'
    }),
    read_sciverse_content: input => ({
      chars_returned: 120,
      doc_id: String(input.doc_id ?? ''),
      more: false,
      next_offset: null,
      text: 'Retrieval-augmented generation retrieves evidence before answering, reducing unsupported claims.'
    }),
    search_sciverse_metadata: () => ({ results: [] }),
    get_sciverse_metadata_catalog: () => ({ fields: ['title', 'doi', 'year'] }),
    search_sciverse_paper_schema: () => ({ results: [] }),
    get_sciverse_paper_schema: () => ({ schema: {} })
  };
}

export function defaultResearchHandlers(): Record<string, FixtureHandler> {
  return {
    search_papers: input => ({
      query: String(input.query ?? ''),
      source: String(input.source ?? 'all'),
      papers: SYNTHETIC_PAPERS.slice(0, Number(input.limit ?? 3))
    }),
    import_papers: () => ({ imported: [], already_present: [], failed: [] }),
    search_web: () => ({
      results: [
        {
          title: 'Transformer survey (synthetic)',
          url: 'https://example.org/transformer-survey',
          snippet: 'A survey of transformer architectures and their applications.',
          content:
            'Survey point one: attention replaces recurrence. Point two: scaling laws guide ' +
            'model size. Point three: retrieval extends context.'
        },
        {
          title: 'Efficient attention (synthetic)',
          url: 'https://example.org/efficient-attention',
          snippet: 'Sparse and linear attention variants reduce cost.',
          content: 'Sparse attention lowers compute while retaining most accuracy.'
        }
      ]
    }),
    read_webpage: input => ({
      results: [
        {
          title: 'Transformer survey (synthetic)',
          url: String(input.url ?? ''),
          content:
            'Point one: self-attention connects every pair of tokens. Point two: multi-head ' +
            'attention learns several representation subspaces. Point three: positional encodings ' +
            'inject order information.'
        }
      ]
    })
  };
}
