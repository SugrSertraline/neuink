type SegmentEditorCloseHandler = {
  discard: () => void;
  save: () => Promise<boolean>;
  isDirty?: () => boolean;
};

const dirtyOwnersByScope = new Map<string, Set<string>>();
const closeHandlersByScope = new Map<string, Map<string, SegmentEditorCloseHandler>>();

// Older reader wrappers still pass a content-tab value. Normalize at every boundary,
// including cleanup, so a mounted legacy editor cannot disappear from safety checks.
export function normalizeSegmentEditorScope(scopeKey: string) {
  const legacy = /^entry-content:([^|]+)\|(pdf|reflow|segment-notes)$/.exec(scopeKey);
  return legacy ? `${legacy[2] === 'segment-notes' ? 'segment-records' : legacy[2]}:${legacy[1]}` : scopeKey;
}

export function setSegmentEditorDirty(
  scopeKey: string,
  ownerId: string,
  dirty: boolean,
) {
  scopeKey = normalizeSegmentEditorScope(scopeKey);
  if (dirty) {
    const owners = dirtyOwnersByScope.get(scopeKey) ?? new Set<string>();
    owners.add(ownerId);
    dirtyOwnersByScope.set(scopeKey, owners);
    return;
  }

  const owners = dirtyOwnersByScope.get(scopeKey);
  owners?.delete(ownerId);
  if (owners?.size === 0) {
    dirtyOwnersByScope.delete(scopeKey);
  }
}

export function registerSegmentEditorCloseHandler(
  scopeKey: string,
  ownerId: string,
  handler: SegmentEditorCloseHandler,
) {
  scopeKey = normalizeSegmentEditorScope(scopeKey);
  const handlers = closeHandlersByScope.get(scopeKey) ?? new Map();
  handlers.set(ownerId, handler);
  closeHandlersByScope.set(scopeKey, handlers);

  return () => {
    const current = closeHandlersByScope.get(scopeKey);
    current?.delete(ownerId);
    if (current?.size === 0) {
      closeHandlersByScope.delete(scopeKey);
    }
  };
}

export function hasUnsavedSegmentEditors(scopeKey: string) {
  scopeKey = normalizeSegmentEditorScope(scopeKey);
  return matchingScopes(scopeKey).some((scope) => (dirtyOwnersByScope.get(scope)?.size ?? 0) > 0);
}

function matchingScopes(scopeKey: string) {
  return [...dirtyOwnersByScope.keys()].filter((scope) => scope === scopeKey || scope.startsWith(`${scopeKey}/`));
}

export function hasAnyUnsavedSegmentEditors() {
  return dirtyOwnersByScope.size > 0;
}

export function hasUnsavedEntrySegmentEditors(entryId: string) {
  return [...dirtyOwnersByScope.keys()].some((scope) =>
    ['pdf', 'reflow', 'segment-records'].some((kind) => scope === `${kind}:${entryId}` || scope.endsWith(`/${kind}:${entryId}`)));
}

export async function saveSegmentEditorsBeforeClose(scopeKey: string) {
  scopeKey = normalizeSegmentEditorScope(scopeKey);
  for (const child of matchingScopes(scopeKey).filter((scope) => scope !== scopeKey)) {
    if (!await saveSegmentEditorsBeforeClose(child)) return false;
  }
  const dirtyOwners = Array.from(dirtyOwnersByScope.get(scopeKey) ?? []);
  for (const ownerId of dirtyOwners) {
    const handler = closeHandlersByScope.get(scopeKey)?.get(ownerId);
    if (!handler) {
      return false;
    }
    try {
      if (!(await handler.save())) return false;
      if (handler.isDirty?.()) return false;
      setSegmentEditorDirty(scopeKey, ownerId, false);
    } catch {
      return false;
    }
  }
  return !hasUnsavedSegmentEditors(scopeKey);
}

export async function saveAllSegmentEditorsBeforeWorkspaceChange() {
  for (const scope of Array.from(dirtyOwnersByScope.keys())) {
    if (!await saveSegmentEditorsBeforeClose(scope)) return false;
  }
  return !hasAnyUnsavedSegmentEditors();
}

export function discardSegmentEditorsBeforeClose(scopeKey: string) {
  scopeKey = normalizeSegmentEditorScope(scopeKey);
  for (const child of matchingScopes(scopeKey).filter((scope) => scope !== scopeKey)) discardSegmentEditorsBeforeClose(child);
  const dirtyOwners = Array.from(dirtyOwnersByScope.get(scopeKey) ?? []);
  for (const ownerId of dirtyOwners) {
    closeHandlersByScope.get(scopeKey)?.get(ownerId)?.discard();
    setSegmentEditorDirty(scopeKey, ownerId, false);
  }
}
