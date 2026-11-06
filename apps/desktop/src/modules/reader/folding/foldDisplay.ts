import type { ReaderPreferences, ReflowOriginalDisplay } from '@/shared/lib/readerPreferences';
import { resolveReflowContent } from '@/shared/lib/reflowContentPreferences';
import type { FoldLevel } from './useFoldReader';

export function initialFoldLevel(preferences: ReaderPreferences): FoldLevel {
  const content = resolveReflowContent('paragraph', preferences.reflowTranslationMode, preferences.reflowComponents.content?.paragraph);
  return content.translationView === 'sentences' ? 'off' : 'full';
}

export function effectiveFoldOriginal(level: FoldLevel, stored: ReflowOriginalDisplay): ReflowOriginalDisplay {
  return level !== 'off' && stored === 'sentences' ? 'original' : stored;
}

export function foldLevelAfterOriginalChange(level: FoldLevel, requested: ReflowOriginalDisplay): FoldLevel {
  return requested === 'sentences' ? 'off' : level === 'off' ? 'full' : level;
}
