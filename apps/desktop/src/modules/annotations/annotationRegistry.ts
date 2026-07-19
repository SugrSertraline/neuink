import annotationTypeDefinitions from './config/annotation-types.json';

import type { AnnotationImportance } from '@/shared/types/domain';

export type AnnotationTypeDefinition = {
  description: string;
  id: string;
  label: string;
};

export const ANNOTATION_TYPES = annotationTypeDefinitions as AnnotationTypeDefinition[];

export const IMPORTANCE_OPTIONS: Array<{ label: string; value: AnnotationImportance }> = [
  { value: 'normal', label: '普通' },
  { value: 'important', label: '重要' },
  { value: 'core', label: '核心' }
];

export function getAnnotationTypeDefinition(kind: string) {
  const normalizedKind = kind.trim();
  return ANNOTATION_TYPES.find((item) => item.id === normalizedKind) ?? null;
}

export function annotationKindLabel(kind: string) {
  const normalizedKind = kind.trim();
  return getAnnotationTypeDefinition(normalizedKind)?.label ?? (normalizedKind || '未分类');
}

export function annotationImportanceLabel(importance: AnnotationImportance) {
  return IMPORTANCE_OPTIONS.find((item) => item.value === importance)?.label ?? importance;
}

export function annotationImportanceRank(importance: AnnotationImportance) {
  if (importance === 'core') {
    return 3;
  }
  if (importance === 'important') {
    return 2;
  }
  return 1;
}
