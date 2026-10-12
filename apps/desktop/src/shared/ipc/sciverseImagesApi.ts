import { invoke } from '@tauri-apps/api/core';

export function saveSciverseNoteImage(request: {
  root: string;
  entryId: string;
  noteId: string;
  reference: string;
}) {
  return invoke<{ markdown_path: string; file_path: string }>('save_sciverse_note_image', {
    request: {
      root: request.root,
      entry_id: request.entryId,
      note_id: request.noteId,
      reference: request.reference
    }
  });
}
