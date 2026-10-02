import { describe, expect, it } from 'vitest';
import { paperPresentationError, paperRecords, parsePaperPresentation } from './paperPresentation';
import type { ResearchPaper } from '@/shared/ipc/researchApi';
const paper: ResearchPaper = { id: 'a', title: 'Actual title', authors: [], year: '2024', provider: 'arxiv', url: 'https://example.org/paper', doi: '', abstract_text: '', evidence_level: 'abstract', pdf_url: null };
const block = (items: unknown[]) => `\`\`\`neuink-papers\n${JSON.stringify({ items })}\n\`\`\``;

describe('paper presentation contract', () => {
  it('keeps text and structured selection in order without matching titles', () => {
    const parts = parsePaperPresentation(`Intro\n${block([{ ref: 'research:a', reason: 'Relevant', group: 'CV' }])}\nLimits`);
    expect(parts.map(part => part.kind)).toEqual(['text', 'papers', 'text']);
    expect(paperPresentationError(block([{ ref: 'research:a', reason: 'Relevant' }]), paperRecords([paper], []))).toBeUndefined();
  });
  it('rejects unknown IDs even when the title matches, duplicate refs and malformed blocks', () => {
    const records = paperRecords([paper], []);
    expect(paperPresentationError(block([{ ref: 'research:b', reason: 'Actual title' }]), records)).toContain('not retrieved');
    expect(paperPresentationError(block([{ ref: 'research:a', reason: '' }, { ref: 'research:a', reason: '' }]), records)).toContain('repeat');
    for (const text of ['```neuink-papers\n{', block([]), block([{ ref: 'research:a', reason: 1 }])]) {
      expect(paperPresentationError(text, records)).toContain('Invalid');
    }
  });
  it('does not expose a partial block while streaming and never mutates source identities', () => {
    expect(parsePaperPresentation('```neuink-papers\n{"items":', true)).toEqual([{ kind: 'pending' }]);
    const source = { provider: 'sciverse' as const, doc_id: 'a', quote: 'raw', title: 'Actual', page_no: 2 };
    const records = paperRecords([paper], [source, source]);
    expect([...records.keys()]).toEqual(['research:a', 'sciverse:a']);
    expect(records.get('sciverse:a')).toMatchObject({ source });
  });
  it('treats ordinary Markdown as text, not an implicit import request', () => {
    expect(parsePaperPresentation('[Actual title](https://example.org/paper)')).toEqual([{ kind: 'text', text: '[Actual title](https://example.org/paper)' }]);
  });
});
