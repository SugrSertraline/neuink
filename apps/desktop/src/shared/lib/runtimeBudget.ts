/** Conservative hints, not a device benchmark. Unknown devices keep the existing retention time. */
export function readerRuntimeBudget(hints: { hardwareConcurrency?: number; deviceMemory?: number } = typeof navigator === 'undefined' ? {} : navigator) {
  const constrained = (Number.isFinite(hints.hardwareConcurrency) && hints.hardwareConcurrency! > 0 && hints.hardwareConcurrency! <= 4)
    || (Number.isFinite(hints.deviceMemory) && hints.deviceMemory! > 0 && hints.deviceMemory! <= 4);
  return { idleReaderMs: constrained ? 60_000 : 300_000, retainedHiddenReaders: constrained ? 1 : 3 };
}
