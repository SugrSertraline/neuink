import type { Annotation, SegmentBlockNote, SourceSegment } from '@/shared/types/domain';
import { matchesSegmentUid } from './railLayout';
import { hasNoteText, logicalSegmentUid } from './readerUtils';
import type { RailLayoutItem } from './types';

export type SegmentRailMarks = {
  bookmarkSegmentUids: ReadonlySet<string>;
  noteSegmentUids: ReadonlySet<string>;
  annotationSegmentUids: ReadonlySet<string>;
};

export function buildSegmentRailMarks(notes: Map<string, SegmentBlockNote>, annotations: Map<string, Annotation[]>): SegmentRailMarks {
  return {
    bookmarkSegmentUids: new Set([...notes].filter(([, note]) => note.bookmarked).map(([uid]) => uid)),
    noteSegmentUids: new Set([...notes].filter(([, note]) => hasNoteText(note.text)).map(([uid]) => uid)),
    annotationSegmentUids: new Set([...annotations].filter(([, records]) => records.length > 0).map(([uid]) => uid))
  };
}

export function hasSegmentRailMark(segment: SourceSegment, marks: SegmentRailMarks) {
  return matchesSegmentUid(segment, marks.bookmarkSegmentUids)
    || matchesSegmentUid(segment, marks.noteSegmentUids)
    || matchesSegmentUid(segment, marks.annotationSegmentUids);
}

export function segmentRailJumpTarget(item: RailLayoutItem, marks: SegmentRailMarks) {
  // A marked cluster must lead to a saved position, even when an unmarked neighbor is active.
  return item.segments.find(segment => matchesSegmentUid(segment, marks.bookmarkSegmentUids))
    ?? item.segments.find(segment => hasSegmentRailMark(segment, marks)) ?? item.segment;
}

export function summarizeSegmentRailMarks(segments: SourceSegment[], marks: SegmentRailMarks) {
  const bookmarks = new Set<string>();
  const notes = new Set<string>();
  const annotations = new Set<string>();
  for (const segment of segments) {
    const uid = logicalSegmentUid(segment);
    if (matchesSegmentUid(segment, marks.bookmarkSegmentUids)) bookmarks.add(uid);
    if (matchesSegmentUid(segment, marks.noteSegmentUids)) notes.add(uid);
    if (matchesSegmentUid(segment, marks.annotationSegmentUids)) annotations.add(uid);
  }
  return { bookmarks: bookmarks.size, notes: notes.size, annotations: annotations.size,
    total: new Set([...bookmarks, ...notes, ...annotations]).size };
}

export type SegmentRailMarkSummary = ReturnType<typeof summarizeSegmentRailMarks>;

export function segmentRailMarkLabel(summary: SegmentRailMarkSummary) {
  return [summary.bookmarks && `收藏 ${summary.bookmarks} 处`, summary.notes && `笔记 ${summary.notes} 处`,
    summary.annotations && `批注 ${summary.annotations} 处`].filter(Boolean).join('，');
}
