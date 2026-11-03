const openings = new Map<string, number>();
/** A short-lived handoff, not a reading preference or a persisted document flag. */
export function markBookOpening(id: string) {
  const now = Date.now();
  for (const [key, time] of openings) if (now - time > 15000) openings.delete(key);
  openings.set(id, now);
}
export function hasBookOpening(id: string) {
  return Date.now() - (openings.get(id) ?? 0) < 15000;
}
