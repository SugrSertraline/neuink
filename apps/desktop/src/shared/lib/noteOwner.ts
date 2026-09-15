import type { NoteOwner, NoteTarget } from '@/shared/types/domain';

// Registry identity is not a storage Entry ID. Existing entry note identities stay compatible.
export const noteOwnerKey = (owner: NoteOwner) => owner.kind === 'entry' ? owner.entry_id : `tag-reading:${owner.tag_id}`;
export const noteTargetKey = (target: NoteTarget) => `${noteOwnerKey(target.owner)}:${target.note_id}`;
export const sameNoteTarget = (a: NoteTarget | null | undefined, b: NoteTarget | null | undefined) => Boolean(a && b && noteTargetKey(a) === noteTargetKey(b));
