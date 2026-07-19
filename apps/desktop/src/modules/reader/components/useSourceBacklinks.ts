import { useEffect, useRef, useState } from 'react';

import type { NoteDocument } from '@/shared/types/domain';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { SourceBacklink, SourceBacklinksBySegmentUid } from '../types';

const READ_CONCURRENCY = 8;

type NoteDescriptor = {
  entryId: string;
  entryTitle: string;
  noteId: string;
  fallbackTitle: string;
  refreshKey: number;
};

type CachedNote = {
  document: NoteDocument;
  refreshKey: number;
};

export function useSourceBacklinks(
  entries: LibraryEntry[],
  markdownNoteRefreshById: Record<string, number>,
  readMarkdownNote: (entryId: string, noteId: string) => Promise<NoteDocument>
) {
  const cacheRef = useRef(new Map<string, CachedNote>());
  const [backlinks, setBacklinks] = useState<Record<string, SourceBacklinksBySegmentUid>>({});

  useEffect(() => {
    let cancelled = false;
    const notes = collectNotes(entries, markdownNoteRefreshById);
    const noteKeys = new Set(notes.map(noteKey));
    for (const key of cacheRef.current.keys()) {
      if (!noteKeys.has(key)) cacheRef.current.delete(key);
    }

    const pending = notes.filter((note) => cacheRef.current.get(noteKey(note))?.refreshKey !== note.refreshKey);
    void readNotesInBatches(pending, readMarkdownNote).then((loaded) => {
      if (cancelled) return;
      for (const item of loaded) {
        if (item.document) {
          cacheRef.current.set(noteKey(item.note), { document: item.document, refreshKey: item.note.refreshKey });
        }
      }
      setBacklinks(buildBacklinks(notes, cacheRef.current));
    });

    return () => { cancelled = true; };
  }, [entries, markdownNoteRefreshById, readMarkdownNote]);

  return backlinks;
}

function collectNotes(entries: LibraryEntry[], refreshById: Record<string, number>): NoteDescriptor[] {
  return entries.flatMap((entry) => entry.contents.flatMap((content) => content.kind === 'note' ? [{
    entryId: entry.id,
    entryTitle: entry.title,
    fallbackTitle: content.title,
    noteId: content.note_id,
    refreshKey: refreshById[`${entry.id}:${content.note_id}`] ?? 0
  }] : []));
}

async function readNotesInBatches(
  notes: NoteDescriptor[],
  readMarkdownNote: (entryId: string, noteId: string) => Promise<NoteDocument>
) {
  const loaded: Array<{ note: NoteDescriptor; document: NoteDocument | null }> = [];
  for (let index = 0; index < notes.length; index += READ_CONCURRENCY) {
    const batch = notes.slice(index, index + READ_CONCURRENCY);
    loaded.push(...await Promise.all(batch.map(async (note) => {
      try {
        return { note, document: await readMarkdownNote(note.entryId, note.noteId) };
      } catch {
        return { note, document: null };
      }
    })));
  }
  return loaded;
}

function buildBacklinks(notes: NoteDescriptor[], cache: Map<string, CachedNote>) {
  const backlinks: Record<string, SourceBacklinksBySegmentUid> = {};
  for (const note of notes) {
    const document = cache.get(noteKey(note))?.document;
    if (!document) continue;
    for (const link of document.links) {
      for (const source of link.sources) {
        addBacklink(backlinks, {
          anchorId: link.anchor_id,
          displayText: link.display_text,
          linkId: link.link_id,
          noteEntryId: note.entryId,
          noteEntryTitle: note.entryTitle,
          noteId: note.noteId,
          noteTitle: document.title || note.fallbackTitle,
          sourceEntryId: source.entry_id,
          segmentUid: source.segment_uid
        });
      }
    }
  }
  return backlinks;
}

function addBacklink(target: Record<string, SourceBacklinksBySegmentUid>, backlink: SourceBacklink) {
  const entryBacklinks = target[backlink.sourceEntryId] ?? {};
  const segmentBacklinks = entryBacklinks[backlink.segmentUid] ?? [];
  if (segmentBacklinks.some((item) => item.linkId === backlink.linkId)) return;
  target[backlink.sourceEntryId] = { ...entryBacklinks, [backlink.segmentUid]: [...segmentBacklinks, backlink] };
}

function noteKey(note: Pick<NoteDescriptor, 'entryId' | 'noteId'>) {
  return `${note.entryId}:${note.noteId}`;
}
