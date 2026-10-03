import { expect, it } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { jumpForSurface, reflowJumpTarget } from './sourceJump';
import type { ReflowSegmentGroup } from './components/reflow/buildReflowBlocks';
import type { PdfJumpRequest } from './types';

it('routes a citation only to the chosen stable view, including inactive duplicates', () => {
  const request: PdfJumpRequest = { kind: 'page', pageIdx: 3, requestKey: 1, targetSurfaceKey: 'pdf:p:view:copy' };
  expect(jumpForSurface(request, 'pdf:p:view:copy')).toBe(request);
  expect(jumpForSurface(request, 'pdf:p')).toBeNull();
  expect(jumpForSurface(request, 'reflow:p')).toBeNull();
  const untargeted = { ...request, targetSurfaceKey: undefined };
  expect(jumpForSurface(untargeted, 'pdf:p')).toBe(untargeted);
});

const segments = [
  { uid: 'first', page_idx: 2 },
  { uid: 'exact', continuation_group_id: 'logical', page_idx: 3 }
] as SourceSegment[];
const groups: ReflowSegmentGroup[] = segments.map(body => ({ body, id: body.uid, kind: 'text', segments: [body], captions: [], footnotes: [] }));

it('resolves both current and logical reflow segment ids before page fallback', () => {
  const request: PdfJumpRequest = { kind: 'segment', segmentUid: 'exact', pageIdx: 2, requestKey: 1 };
  expect(reflowJumpTarget(groups, request)).toEqual({ pageIdx: 3, segmentUid: 'exact' });
  expect(reflowJumpTarget(groups, { ...request, segmentUid: 'logical' })).toEqual({ pageIdx: 3, segmentUid: 'exact' });
  expect(reflowJumpTarget(groups, { ...request, segmentUid: 'old-parser-id' })).toEqual({ pageIdx: 2, segmentUid: 'first' });
});

it('uses the saved page for page-only citations and rejects pages without a navigable group', () => {
  const request: PdfJumpRequest = { kind: 'page', pageIdx: 2, requestKey: 2 };
  expect(reflowJumpTarget([], request)).toBeNull();
  expect(reflowJumpTarget(groups, request)).toEqual({ pageIdx: 2, segmentUid: 'first' });
  expect(reflowJumpTarget(groups, { ...request, pageIdx: 999 })).toBeNull();
});
