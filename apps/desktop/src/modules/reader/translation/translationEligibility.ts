import type { SegmentType } from '@/shared/types/domain';

// Display policy only: these may still be translated and saved.
// MinerU algorithms are normalized to the code segment type.
export function preservesOriginalContent(type: SegmentType) {
  return type === 'code' || type === 'table' || type === 'figure' || type === 'math';
}
