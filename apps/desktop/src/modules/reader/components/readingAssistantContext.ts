import type { AssistantContextAddOptions, AssistantContextInput } from '@/shared/types/assistant';
import type { SourceSegment } from '@/shared/types/domain';

export function readingAssistantContext(entry: { id: string; title: string }, segment: SourceSegment,
  options?: AssistantContextAddOptions): AssistantContextInput {
  return {
    ...(options?.selectionText ? { id: `selection:${entry.id}:${segment.uid}` } : {}),
    kind: 'segment', entryId: entry.id, entryTitle: entry.title,
    segmentUid: segment.uid, pageIdx: segment.page_idx,
    text: options?.selectionText ?? segment.markdown ?? segment.text
  };
}
