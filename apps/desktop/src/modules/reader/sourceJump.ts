import type { ReflowSegmentGroup } from './components/reflow/buildReflowBlocks';
import type { PdfJumpRequest } from './types';

export function jumpForSurface(request: PdfJumpRequest | null, surfaceKey: string) {
  return request?.targetSurfaceKey && request.targetSurfaceKey !== surfaceKey ? null : request;
}

export function reflowJumpTarget(visibleGroups: ReflowSegmentGroup[], request: PdfJumpRequest) {
  if (request.kind !== 'page') {
    for (const group of visibleGroups) {
      const exact = group.segments.find(segment => segment.uid === request.segmentUid || segment.continuation_group_id === request.segmentUid);
      if (exact) return { pageIdx: group.body.page_idx, segmentUid: exact.uid };
    }
  }
  // Page headers and hidden components have no mounted/virtual row. Resolve the
  // fallback from navigable groups, never from the unfiltered parsing result.
  const group = visibleGroups.find(candidate => candidate.segments.some(segment => segment.page_idx === request.pageIdx));
  return group ? { pageIdx: group.body.page_idx, segmentUid: group.body.uid } : null;
}
