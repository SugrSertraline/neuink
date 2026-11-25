import type { FoldRecord } from '@/shared/ipc/foldingApi';

export const FOLD_TRANSLATION_LEVELS = ['brief', 'key', 'takeaway', 'topic'] as const;
export type FoldTranslationLevel = typeof FOLD_TRANSLATION_LEVELS[number];
export type FoldTranslationLanguage = 'zh' | 'en';

/** Keep source-language text as one side; translate the other side without duplicating it. */
export function foldSourceLanguage(source: string): 'zh' | 'en' | 'other' {
  const han = (source.match(/\p{Script=Han}/gu) ?? []).length;
  const latin = (source.match(/\p{Script=Latin}/gu) ?? []).length;
  if (han >= 4 && han * 2 >= latin) return 'zh';
  if (latin >= 4 && latin > han * 2) return 'en';
  return 'other';
}
export const foldTranslationKey = (level: FoldTranslationLevel, language: FoldTranslationLanguage) => language === 'en' ? `en:${level}` : level;
export const foldDisplayTranslationLanguage = (record: FoldRecord): FoldTranslationLanguage => foldSourceLanguage(record.source) === 'zh' ? 'en' : 'zh';
export function missingFoldTranslationTasks(record: FoldRecord): Array<{ level: FoldTranslationLevel; language: FoldTranslationLanguage }> {
  const language = foldSourceLanguage(record.source);
  const targets: FoldTranslationLanguage[] = language === 'zh' ? ['en'] : language === 'en' ? ['zh'] : ['zh', 'en'];
  return FOLD_TRANSLATION_LEVELS.flatMap(level => {
    const source = level === 'brief' ? record.brief.join(' ') : record[level];
    return targets.filter(target => {
      const saved = record.translations?.[foldTranslationKey(level, target)];
      return !saved?.translated_text.trim() || saved.source_text !== source;
    }).map(target => ({ level, language: target }));
  });
}
export function missingFoldTranslations(record: FoldRecord) {
  return [...new Set(missingFoldTranslationTasks(record).map(item => item.level))];
}
