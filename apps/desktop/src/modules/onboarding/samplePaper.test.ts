import { describe, expect, it } from 'vitest';
import type { EntryMeta } from '@/shared/types/domain';
import { findLocalOnboardingPaper, isOnboardingPaper } from './samplePaper';
const paper = (title:string, fields = {}, filename = 'paper.pdf') => ({ id:title, title, fields, pdf:{ file_name:filename } } as EntryMeta);
describe('local example identity', () => {
  it('recognizes exact title, filename or arxiv identity, not a related title', () => {
    expect(isOnboardingPaper(paper('Attention Is All You Need'))).toBe(true);
    expect(isOnboardingPaper(paper('my paper', {}, '1706.03762v5.pdf'))).toBe(true);
    expect(isOnboardingPaper(paper('my paper', { arxiv_id:'1706.03762' }))).toBe(true);
    expect(isOnboardingPaper(paper('Attention Is All You Need for Graphs'))).toBe(false);
    expect(isOnboardingPaper(paper('my paper', { arxiv_id:'1706.037620' }))).toBe(false);
  });
  it('requires PDF metadata and prefers a known tutorial entry', () => {
    const manual = paper('Attention Is All You Need');
    const example = paper('renamed', { tutorial_demo:'attention-v1' });
    expect(findLocalOnboardingPaper([manual, example])).toBe(example);
    expect(findLocalOnboardingPaper([{ ...manual, pdf:null }])).toBeUndefined();
    expect(findLocalOnboardingPaper([manual])).toBeUndefined();
  });
});
