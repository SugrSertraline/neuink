import type { ParagraphTranslation } from '@/shared/ipc/paragraphTranslationApi';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { SourceSegment } from '@/shared/types/domain';

export function hasSentenceTranslation(record?: ParagraphTranslation) {
  return record?.sentences.status === 'succeeded' && Boolean(record.sentences.value?.length)
    && record.sentences.value!.every(pair => pair.translation.trim());
}

export function paragraphTranslationRunning(record?: ParagraphTranslation) {
  return record?.paragraph.status === 'running' || record?.sentences.status === 'running';
}

export function hasParagraphTranslation(record?: ParagraphTranslation) {
  return record?.paragraph.status === 'succeeded' && Boolean(record.paragraph.value?.trim());
}

export function hasMatchingDocumentTranslation(segment: SourceSegment, translation?: TranslatedSegment) {
  return translation?.segment_uid === segment.uid && translation.status === 'translated'
    && translation.source_text === (segment.markdown ?? segment.text) && Boolean(translation.translated_text?.trim());
}
