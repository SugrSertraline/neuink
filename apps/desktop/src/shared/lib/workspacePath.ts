/** Compare event paths only; storage identities and native authorization keep their own contracts. */
export function sameWorkspacePath(left: string, right: string): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const key = (value: string) => {
    const path = value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
    if (/^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('//')) {
      return `windows:${path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`;
    }
    return `other:${path.replace(/\/+$/, '') || '/'}`;
  };
  return key(left) === key(right);
}
