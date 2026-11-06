import type { FoldRecord } from '@/shared/ipc/foldingApi';

export const FOLD_TRANSLATION_LEVELS = ['brief', 'key', 'takeaway', 'topic'] as const;
export function missingFoldTranslations(record: FoldRecord) {
  return FOLD_TRANSLATION_LEVELS.filter(level => {
    const source = level === 'brief' ? record.brief.join(' ') : record[level];
    const saved = record.translations?.[level];
    return !saved?.translated_text.trim() || saved.source_text !== source;
  });
}
