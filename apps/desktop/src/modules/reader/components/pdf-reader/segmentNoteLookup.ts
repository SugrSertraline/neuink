import type { SegmentBlockNote, SourceSegment } from '@/shared/types/domain';
import { hasNoteText, logicalSegmentUid } from './readerUtils';

// Persistence uses a real segment uid; all reading surfaces also address its logical group.
export function buildSegmentNoteLookup(notes: SegmentBlockNote[], segments: SourceSegment[]) {
  const segmentByUid = new Map(segments.map((segment) => [segment.uid, segment]));
  const lookup = new Map<string, SegmentBlockNote>();
  for (const note of notes) {
    if (!hasNoteText(note.text)) continue;
    lookup.set(note.segment_uid, note);
    const segment = segmentByUid.get(note.segment_uid);
    if (segment) lookup.set(logicalSegmentUid(segment), note);
  }
  return lookup;
}
