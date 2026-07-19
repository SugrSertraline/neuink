const dirtyNoteOwners = new Map<string, Set<string>>();
const saveHandlersByNote = new Map<string, Map<string, () => Promise<boolean>>>();

function noteKey(entryId: string, noteId: string) {
  return `${entryId}:${noteId}`;
}

export function setMarkdownNoteDirty(
  entryId: string,
  noteId: string,
  ownerId: string,
  dirty: boolean
) {
  const key = noteKey(entryId, noteId);
  if (dirty) {
    const owners = dirtyNoteOwners.get(key) ?? new Set<string>();
    owners.add(ownerId);
    dirtyNoteOwners.set(key, owners);
    return;
  }
  const owners = dirtyNoteOwners.get(key);
  if (!owners) {
    return;
  }
  owners.delete(ownerId);
  if (owners.size === 0) {
    dirtyNoteOwners.delete(key);
  }
}

export function hasUnsavedMarkdownNote(entryId: string, noteId: string) {
  return (dirtyNoteOwners.get(noteKey(entryId, noteId))?.size ?? 0) > 0;
}

export function hasAnyUnsavedMarkdownNotes() {
  return dirtyNoteOwners.size > 0;
}

export function registerMarkdownNoteSaveHandler(
  entryId: string,
  noteId: string,
  ownerId: string,
  save: () => Promise<boolean>
) {
  const key = noteKey(entryId, noteId);
  const handlers = saveHandlersByNote.get(key) ?? new Map<string, () => Promise<boolean>>();
  handlers.set(ownerId, save);
  saveHandlersByNote.set(key, handlers);

  return () => {
    const currentHandlers = saveHandlersByNote.get(key);
    if (!currentHandlers) {
      return;
    }
    currentHandlers.delete(ownerId);
    if (currentHandlers.size === 0) {
      saveHandlersByNote.delete(key);
    }
  };
}

export async function saveMarkdownNoteBeforeClose(entryId: string, noteId: string) {
  const handlers = Array.from(saveHandlersByNote.get(noteKey(entryId, noteId))?.values() ?? []);
  if (handlers.length === 0) {
    return false;
  }
  const results = await Promise.all(handlers.map((save) => save()));
  return results.every(Boolean);
}

export async function saveAllMarkdownNotesBeforeWorkspaceChange() {
  const dirtyKeys = Array.from(dirtyNoteOwners.keys());
  for (const key of dirtyKeys) {
    const handlers = Array.from(saveHandlersByNote.get(key)?.values() ?? []);
    if (handlers.length === 0) {
      return false;
    }
    const results = await Promise.all(handlers.map((save) => save()));
    if (!results.every(Boolean)) {
      return false;
    }
  }
  return true;
}
