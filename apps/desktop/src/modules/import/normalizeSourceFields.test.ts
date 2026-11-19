import { expect, it } from 'vitest';
import { normalizeSourceFields } from './normalizeSourceFields';
it('translates known imported fields without losing conflicts or custom values', () => {
  const source = { authors: 'Ada', year: '2024', doi: '10.1/old', DOI: '10.1/new', publicationTitle: 'Journal', custom: 'keep' };
  expect(normalizeSourceFields(source)).toEqual({ 作者: 'Ada', 发表年份: '2024', doi: '10.1/old', DOI: '10.1/new', '期刊／会议名称': 'Journal', custom: 'keep' });
  expect(source.authors).toBe('Ada');
});
