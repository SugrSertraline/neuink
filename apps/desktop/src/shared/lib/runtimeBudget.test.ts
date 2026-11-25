import { expect, it } from 'vitest';
import { readerRuntimeBudget } from './runtimeBudget';
it('bounds hidden readers on low-core or low-memory devices, retaining defaults when unknown', () => {
  expect(readerRuntimeBudget({ hardwareConcurrency: 2 }).retainedHiddenReaders).toBe(1);
  expect(readerRuntimeBudget({ hardwareConcurrency: 16, deviceMemory: 4 }).idleReaderMs).toBe(60_000);
  expect(readerRuntimeBudget({}).idleReaderMs).toBe(300_000);
  expect(readerRuntimeBudget({ hardwareConcurrency: 0 }).idleReaderMs).toBe(300_000);
});
