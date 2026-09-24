import { parseListItems } from './ListHoverPreview';

const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
const number = (marker: string | null) => marker?.match(/^(?:\[(\d+)\]|(\d+)[.)])$/)?.slice(1).find(Boolean);
type Item = ReturnType<typeof parseListItems>[number];
const format = (item: Item) => `${item.marker ? `${item.marker} ` : ''}${item.text}`;

/** Geometry order is independent of the source/translation reading order. */
export function translatedListItemText(regionText: string, sourceText: string, translation: string): string | null {
  const regionItems = parseListItems(regionText);
  // A merged region does not identify a single translated item.
  if (regionItems.length > 1) return null;
  const region = regionItems[0] ?? { marker: null, text: regionText };
  const source = parseListItems(sourceText);
  const translated = parseListItems(translation);
  const regionNumber = number(region.marker);
  const matches = source.map((item, index) => ({ item, index })).filter(({ item }) => {
    const candidateNumber = number(item.marker);
    return regionNumber && candidateNumber
      ? regionNumber === candidateNumber
      : normalize(item.text) === normalize(region.text);
  });
  if (matches.length > 1) return null;
  const match = matches[0];
  const targetNumber = regionNumber ?? (match && number(match.item.marker));

  // Explicit numbers remain authoritative even when the model reordered or
  // omitted entries. Missing/duplicate numbers must never fall back to position.
  if (targetNumber && translated.some(item => number(item.marker))) {
    const candidates = translated.filter(item => number(item.marker) === targetNumber);
    return candidates.length === 1 ? format(candidates[0]) : null;
  }
  if (!match) {
    return source.length === 0 && normalize(regionText) === normalize(sourceText)
      ? translation.trim() || null
      : null;
  }
  // For unnumbered lists, only use the position in the uniquely matched source
  // text, with equal item counts. Never use the index of the PDF region array.
  const translatedItems = translated.length ? translated : translation.split(/\r?\n/)
    .map(text => text.trim()).filter(Boolean).map(text => ({ marker: null, text }));
  if (translatedItems.length !== source.length) return null;
  const candidate = translatedItems[match.index];
  if (number(candidate.marker)) return null;
  return format(candidate);
}
