import type { AppAppearance } from '@/shared/components/AppearanceProvider';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';

export function effectivePdfBookMode(
  appearance: AppAppearance,
  preferences: Pick<ReaderPreferences, 'pageTurningMode'>
) {
  return appearance === 'atelier' && preferences.pageTurningMode === 'book';
}
