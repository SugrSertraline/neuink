type SegmentEditorCloseHandler = {
  discard: () => void;
  save: () => Promise<boolean>;
};

const dirtyOwnersByScope = new Map<string, Set<string>>();
const closeHandlersByScope = new Map<string, Map<string, SegmentEditorCloseHandler>>();

export function setSegmentEditorDirty(
  scopeKey: string,
  ownerId: string,
  dirty: boolean,
) {
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
  return (dirtyOwnersByScope.get(scopeKey)?.size ?? 0) > 0;
}

export async function saveSegmentEditorsBeforeClose(scopeKey: string) {
  const dirtyOwners = Array.from(dirtyOwnersByScope.get(scopeKey) ?? []);
  for (const ownerId of dirtyOwners) {
    const handler = closeHandlersByScope.get(scopeKey)?.get(ownerId);
    if (!handler) {
      return false;
    }
    try {
      if (!(await handler.save())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function discardSegmentEditorsBeforeClose(scopeKey: string) {
  const dirtyOwners = Array.from(dirtyOwnersByScope.get(scopeKey) ?? []);
  for (const ownerId of dirtyOwners) {
    closeHandlersByScope.get(scopeKey)?.get(ownerId)?.discard();
    setSegmentEditorDirty(scopeKey, ownerId, false);
  }
}
