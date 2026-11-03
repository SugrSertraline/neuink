import { expect, it } from 'vitest';
import { buildDailyAdvice, parseDailyAdvice } from './dailyAdvice';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
const entries = [{ id: 'a', title: 'Diffusion', tags: ['AI'], tagIds: ['ai'] }, { id: 'b', title: 'Forecasting', tags: ['AI'], tagIds: ['ai'] }] as LibraryEntry[];
const state = (ms: number) => ({ a: { daily_active_ms: { '2026-10-23': ms }, last_read_at: '2026-10-23T10:00:00Z', total_active_ms: ms, visited_pages: [], page_count: 10 } as unknown as EntryReadingState });
it('prioritizes reading when no paper has been read today and never invents a paper', () => {
  const input = buildDailyAdvice(entries, {}, '2026-10-23');
  expect(input.count).toBe(0); expect(input.candidates[0]).toMatchObject({kind:'read',entryId:'a'});
  expect(buildDailyAdvice([], {}, '2026-10-23').candidates.map(x=>x.kind)).toEqual(['recommendations']);
});
it('recommends reflection and papers after reading without removed journal actions', () => {
  const input = buildDailyAdvice(entries, state(600_000), '2026-10-23');
  expect(input).toMatchObject({count:1,minutes:10}); expect(input.candidates[0].kind).toBe('reflect');
  expect(buildDailyAdvice(entries,state(3_600_000),'2026-10-23').candidates.map(x=>x.kind)).toEqual(['reflect', 'recommendations']);
});
it('checks the current calendar day rather than using all-time totals', () => {
  expect(buildDailyAdvice(entries, state(600_000), '2026-10-24').count).toBe(0);
});
it('only accepts supplied actions and rejects missing/fictional model results', () => {
  const input=buildDailyAdvice(entries,{},'2026-10-23');
  const parsed=parseDailyAdvice({summary:'先读一小段',suggestions:[{id:'read',reason:'从摘要开始'},{id:'read'},{id:'delete_all'},{id:'invented_paper',url:'https://bad.test'}]}, input);
  expect(parsed.suggestions).toHaveLength(1); expect(parsed.suggestions[0]).toMatchObject({entryId:'a',reason:'从摘要开始'});
  expect(()=>parseDailyAdvice({summary:'假论文',suggestions:[{id:'invented_paper'}]},input)).toThrow();
});

