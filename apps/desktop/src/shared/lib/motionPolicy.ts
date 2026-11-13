/** Resolve at interaction time so a changed OS accessibility preference applies immediately. */
export function preferredScrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}
