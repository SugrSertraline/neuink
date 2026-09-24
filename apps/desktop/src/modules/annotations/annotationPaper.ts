import type { Annotation } from '@/shared/types/domain';

// Material only: the annotation and its existing selection color remain the source of truth.
export function annotationPaperProps(annotation: Pick<Annotation, 'text_selection' | 'importance'>) {
  return {
    'data-material': 'annotation-paper',
    'data-paper-color': annotation.text_selection?.color ?? (annotation.importance === 'core' ? 'pink' : 'yellow'),
  };
}
