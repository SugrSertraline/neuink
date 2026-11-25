/** Compare persisted values, not object identity; modification timestamps are metadata. */
export function sameIdeationData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameIdeationData(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = (value: Record<string, unknown>) => Object.keys(value).filter(key => key !== 'updated_at' && value[key] !== undefined);
  const names = keys(left);
  return names.length === keys(right).length && names.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameIdeationData(left[key], right[key]));
}
