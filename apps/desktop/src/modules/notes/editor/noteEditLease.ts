type Listener = () => void;
const owners = new Map<string, string>();
const drafts = new Map<string, { markdown: string; revision: number }>();
const listeners = new Set<Listener>();
const key = (entryId: string, noteId: string) => `${entryId}:${noteId}`;
const emit = () => listeners.forEach((listener) => listener());
export const subscribeNoteEditLease = (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function acquireNoteEditLease(entryId: string, noteId: string, ownerId: string, force = false) {
  const noteKey = key(entryId, noteId); const current = owners.get(noteKey);
  if (!current || current === ownerId || force) { owners.set(noteKey, ownerId); emit(); return true; }
  return false;
}
export function releaseNoteEditLease(entryId: string, noteId: string, ownerId: string) {
  const noteKey = key(entryId, noteId); if (owners.get(noteKey) === ownerId) { owners.delete(noteKey); emit(); }
}
export const ownsNoteEditLease = (entryId: string, noteId: string, ownerId: string) => owners.get(key(entryId, noteId)) === ownerId;
export function publishNoteEditDraft(entryId: string, noteId: string, markdown: string) {
  const noteKey = key(entryId, noteId);
  const current = drafts.get(noteKey);
  if (current?.markdown === markdown) return;
  drafts.set(noteKey, { markdown, revision: (current?.revision ?? 0) + 1 });
  emit();
}
export function clearNoteEditDraft(entryId: string, noteId: string) {
  if (drafts.delete(key(entryId, noteId))) emit();
}
export const getNoteEditDraft = (entryId: string, noteId: string) => drafts.get(key(entryId, noteId)) ?? null;
export const getNoteEditDraftRevision = (entryId: string, noteId: string) => drafts.get(key(entryId, noteId))?.revision ?? 0;
