import type { SourceSegment } from '@/shared/types/domain';
import { createPointerDropSession } from './pointerDropSession';

export type PdfBlockDragItem = {
  entryId: string;
  workspaceRoot: string | null;
  segment: SourceSegment;
  bbox: readonly [number, number, number, number];
};
export const pdfBlockDrag = createPointerDropSession<PdfBlockDragItem>();
