import { expect, it } from 'vitest';
import { SourceLedger } from './sourceLedger';
it('allocates a shared marker namespace and deduplicates evidence', () => {
  const source = { entry_id: 'entry', entry_title: 'Paper', segment_uid: 's1', page_idx: 0, quote: 'Evidence' };
  const ledger = new SourceLedger(new Map([[4, source]]));
  expect(ledger.add(source)).toBe(4);
  expect(ledger.add({ ...source, segment_uid: 's2' })).toBe(5);
  expect(ledger.sources.get(4)).toEqual(source);
});
