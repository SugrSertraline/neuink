type Resource = 'entries' | 'annotations' | 'trash' | 'parsing';

/** Reads may complete after navigation, including A → B → A. Only the latest read in
 * the current workspace session may publish; this does not cancel or delay I/O. */
export function createWorkspaceReadScope() {
  let root: string | null = null;
  let generation = 0;
  const requests = new Map<Resource, number>();
  return {
    open(nextRoot: string | null) {
      root = nextRoot;
      generation += 1;
      requests.clear();
    },
    begin(requestRoot: string, resource: Resource) {
      if (requestRoot !== root) return () => false;
      const session = generation;
      const request = (requests.get(resource) ?? 0) + 1;
      requests.set(resource, request);
      return () => generation === session && root === requestRoot && requests.get(resource) === request;
    }
  };
}
