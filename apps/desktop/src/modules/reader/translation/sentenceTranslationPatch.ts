import { alignSavedTranslation, splitAcademicSentences } from './sentenceAlignment';

export type SentenceTranslationSnapshot = {
  source: string;
  sentenceIndex: number;
  sentence: string;
  paragraphTranslation: string;
};

/** A single-sentence replacement must never consume a merged sentence group. */
export function prepareSentenceTranslationPatch(snapshot: SentenceTranslationSnapshot,
  currentSource: string, currentTranslation: string, replacement: string): string | null {
  if (!replacement.trim() || currentSource !== snapshot.source ||
      currentTranslation !== snapshot.paragraphTranslation) return null;
  const sentences = splitAcademicSentences(currentSource);
  if (sentences[snapshot.sentenceIndex] !== snapshot.sentence) return null;
  const pairs = alignSavedTranslation(currentSource, currentTranslation);
  const pair = pairs?.find(value => value.sourceStartIndex === snapshot.sentenceIndex &&
    value.sourceEndIndex === snapshot.sentenceIndex + 1);
  if (!pair) return null;
  // Preserve all surrounding whitespace and punctuation. Repeated or normalized
  // matches require explicit user selection rather than an inferred replacement.
  const index = currentTranslation.indexOf(pair.translation);
  if (index < 0 || currentTranslation.indexOf(pair.translation, index + 1) >= 0) return null;
  return currentTranslation.slice(0, index) + replacement.trim() + currentTranslation.slice(index + pair.translation.length);
}
