export type ReadingSentence = {
  id: number;
  source: string;
  translation: string;
  sourceStartIndex: number;
  sourceEndIndex: number;
};

const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'fig', 'figs', 'eq', 'eqs', 'sec', 'secs',
  'ref', 'refs', 'vol', 'no', 'vs', 'e.g', 'i.e', 'cf', 'approx', 'al', 'st', 'co', 'ltd',
]);
/** Preserve the source text while avoiding boundaries inside math, citations and abbreviations. */
export function splitAcademicSentences(source: string, translated = false, clauses = false): string[] {
  return splitSentences(source, translated, clauses, false);
}

/** PDF text layers may omit the space after a period between two sentences. */
export function splitPdfTextSentences(source: string): string[] {
  return splitSentences(source, false, false, true);
}

function splitSentences(source: string, translated: boolean, clauses: boolean, tightPdfBoundary: boolean): string[] {
  const sentences: string[] = [];
  let start = 0;
  let cursor = 0;
  let depth = 0;
  while (cursor < source.length) {
    const rest = source.slice(cursor);
    const url = rest.match(/^https?:\/\/[A-Za-z0-9._~:/?#@!$&'*+,;=%-]+/i)?.[0];
    if (url) {
      const urlEnd = cursor + url.length;
      const terminalPunctuation = /[.!?]$/.test(url) && (urlEnd === source.length || /\s/.test(source[urlEnd]));
      cursor = terminalPunctuation ? urlEnd - 1 : urlEnd;
      continue;
    }
    const inlineMathTag = rest.match(/^<(sub|sup)(?:\s[^>]*)?>/i);
    if (inlineMathTag) {
      const closingTag = `</${inlineMathTag[1].toLowerCase()}>`;
      const close = source.toLowerCase().indexOf(closingTag, cursor + inlineMathTag[0].length);
      if (close >= 0) { cursor = close + closingTag.length; continue; }
    }
    const delimiter = rest.startsWith('$$') ? ['$$', '$$'] : rest.startsWith('$') ? ['$', '$']
      : rest.startsWith('\\(') ? ['\\(', '\\)'] : rest.startsWith('\\[') ? ['\\[', '\\]'] : null;
    if (delimiter) {
      const close = source.indexOf(delimiter[1], cursor + delimiter[0].length);
      cursor = close < 0 ? source.length : close + delimiter[1].length;
      continue;
    }
    if (rest.startsWith('`')) {
      const marker = rest.match(/^`+/)![0];
      const close = source.indexOf(marker, cursor + marker.length);
      cursor = close < 0 ? source.length : close + marker.length;
      continue;
    }
    const character = source[cursor];
    // MinerU uses ?? for unreadable symbols; it is not a question boundary.
    if (character === '?' && (source[cursor - 1] === '?' || source[cursor + 1] === '?')) {
      cursor++;
      continue;
    }
    if (character === '[' || character === '(' || character === '（') depth++;
    if (character === ']' || character === ')' || character === '）') depth = Math.max(0, depth - 1);
    let end = cursor + 1;
    const punctuation = translated ? (clauses ? /[.!?。！？；;,，]/ : /[.!?。！？；]/) : /[.!?]/;
    if (depth === 0 && punctuation.test(character) &&
      !(character === '.' && /\d/.test(source[cursor - 1] ?? '') && /\d/.test(source[end] ?? ''))) {
      while (end < source.length && /[.!?。！？；;,，”’"']/.test(source[end])) end++;
      if (!translated) {
        while (/^\s*\[[^\]]*\d[^\]]*\]/.test(source.slice(end))) {
          end += source.slice(end).match(/^\s*\[[^\]]*\d[^\]]*\]/)![0].length;
        }
      }
      const next = source[end];
      const boundary = translated || next === undefined || /\s/.test(next) ||
        (tightPdfBoundary && /[A-Z]/.test(next));
      if (boundary && (character !== '.' || !isAbbreviation(source.slice(0, cursor)))) {
        const sentence = source.slice(start, end).trim();
        if (sentence) sentences.push(sentence);
        start = end;
        cursor = end;
        continue;
      }
    }
    cursor++;
  }
  const tail = source.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function isAbbreviation(prefix: string) {
  const word = prefix.match(/[A-Za-z.]+$/)?.[0] ?? '';
  const lower = word.toLowerCase();
  return ABBREVIATIONS.has(lower) || /^[A-Z]$/.test(word)
    || (word.includes('.') && word.split('.').every(part => /^[A-Za-z]$/.test(part)));
}

const ENGLISH_NUMBERS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
};

function withoutUrls(text: string) {
  return text.replace(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'*+,;=%-]+/gi, ' ')
    .replace(/(\d{1,2})世纪(\d{2})年代/g, (_, century: string, decade: string) =>
      `${(Number(century) - 1) * 100 + Number(decade)}s`);
}

const NUMERIC_TOKEN = /\b\d+(?:\.\d+)?[a-z]?\b/gi;

function explicitNumericAnchors(text: string) {
  return [...withoutUrls(text).matchAll(NUMERIC_TOKEN)].map(match => match[0].toLowerCase());
}

/** Explicit source digits are required; spelled-out numbers may explain digits introduced by translation. */
function matchingNumericAnchors(source: string, translation: string) {
  const sourceTokens = [...withoutUrls(source).matchAll(/\b(?:\d+(?:\.\d+)?[a-z]?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi)]
    .map(match => {
      const word = match[0].toLowerCase();
      return { value: ENGLISH_NUMBERS[word] ?? word, optional: word in ENGLISH_NUMBERS };
    });
  const targetDigits = explicitNumericAnchors(translation);
  const memo = new Map<string, boolean>();
  const matches = (sourceIndex: number, targetIndex: number): boolean => {
    if (sourceIndex === sourceTokens.length) return targetIndex === targetDigits.length;
    const key = `${sourceIndex}:${targetIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const token = sourceTokens[sourceIndex];
    const result = (token.optional && matches(sourceIndex + 1, targetIndex)) ||
      (token.value === targetDigits[targetIndex] && matches(sourceIndex + 1, targetIndex + 1));
    memo.set(key, result);
    return result;
  };
  return matches(0, 0);
}

const SENTENCE_OPENINGS: Array<[RegExp, RegExp]> = [
  [/^To (?:evaluate|assess|investigate|examine)\b/i, /^为(?:评估|评价|研究|考察|检验)/],
  [/^As illustrated\b/i, /^如图/],
  [/^In Fig\.?\b/i, /^在图/],
  [/^Spatial correlations?\b/i, /^空间相关性/],
  [/^However\b/i, /^(?:然而|但是|不过)/],
  [/^Additionally\b/i, /^(?:此外|另外)/],
  [/^Furthermore\b/i, /^(?:此外|进一步|而且)/],
  [/^Although\b/i, /^(?:尽管|虽然)/],
  [/^When\b/i, /^当/],
  [/^Next\b/i, /^(?:接下来|随后)/],
  [/^For (?:instance|example)\b/i, /^例如/],
  [/^This model\b/i, /^该模型/],
  [/^The results\b/i, /^结果/],
];

function startsLikeTranslatedSentence(source: string, translation: string) {
  return SENTENCE_OPENINGS.some(([original, translated]) => original.test(source) && translated.test(translation));
}

/** Pair the saved whole-paragraph result in source order; never generate translated words. */
export function alignSavedTranslation(source: string, translation: string): ReadingSentence[] | null {
  const original = splitAcademicSentences(source);
  if (!original.length) return null;
  const strong = splitAcademicSentences(translation, true);
  if (original.length === 1 && strong.length === 1) return [{ id: 1, source: original[0], translation: strong[0],
    sourceStartIndex: 0, sourceEndIndex: 1 }];
  return alignFragments(original, strong, true)
    ?? (strong.length < original.length
      ? alignFragments(original, splitAcademicSentences(translation, true, true), false)
      : null);
}

function alignFragments(original: string[], fragments: string[], allowSourceMerge: boolean): ReadingSentence[] | null {
  if (!fragments.length || original.length > 30 || fragments.length > 80 ||
    (!allowSourceMerge && fragments.length < original.length)) return null;
  const sourceLength = original.reduce((sum, value) => sum + value.length, 0);
  const translatedLength = fragments.reduce((sum, value) => sum + value.length, 0);
  const costs = Array.from({ length: original.length + 1 }, () => Array<number>(fragments.length + 1).fill(Infinity));
  const previous = Array.from({ length: original.length + 1 }, () =>
    Array<{ sourceStart: number; targetStart: number } | null>(fragments.length + 1).fill(null));
  costs[0][0] = 0;
  for (let sourceStart = 0; sourceStart < original.length; sourceStart++) {
    for (let targetStart = 0; targetStart < fragments.length; targetStart++) {
      if (!Number.isFinite(costs[sourceStart][targetStart])) continue;
      for (let sourceEnd = sourceStart + 1; sourceEnd <= Math.min(original.length, sourceStart + (allowSourceMerge ? 2 : 1)); sourceEnd++) {
        const sourceText = original.slice(sourceStart, sourceEnd).join(' ');
        for (let targetEnd = targetStart + 1; targetEnd <= Math.min(fragments.length, targetStart + 6); targetEnd++) {
          if (sourceEnd > sourceStart + 1 && targetEnd > targetStart + 1) continue;
          const text = fragments.slice(targetStart, targetEnd).join(' ');
          if (sourceEnd > sourceStart + 1 && (sourceText.length < 80 || text.length < 30)) continue;
          if (sourceEnd > sourceStart + 1 && startsLikeTranslatedSentence(original[sourceStart + 1], text) &&
            !startsLikeTranslatedSentence(original[sourceStart], text)) continue;
          if (!matchingNumericAnchors(sourceText, text)) continue;
          const sourceShare = sourceText.length / sourceLength;
          const translatedShare = text.length / translatedLength;
          const cost = costs[sourceStart][targetStart] + Math.pow(sourceShare - translatedShare, 2) +
            (targetEnd - targetStart - 1) * 0.015 + (sourceEnd - sourceStart - 1) * 0.025;
          if (cost < costs[sourceEnd][targetEnd]) {
            costs[sourceEnd][targetEnd] = cost;
            previous[sourceEnd][targetEnd] = { sourceStart, targetStart };
          }
        }
      }
    }
  }
  if (!Number.isFinite(costs[original.length][fragments.length])) return null;
  const pairs: ReadingSentence[] = [];
  let sourceEnd = original.length;
  let targetEnd = fragments.length;
  while (sourceEnd > 0) {
    const step = previous[sourceEnd][targetEnd];
    if (!step) return null;
    pairs.unshift({ id: step.sourceStart + 1, source: original.slice(step.sourceStart, sourceEnd).join(' '),
      translation: fragments.slice(step.targetStart, targetEnd).join(' '),
      sourceStartIndex: step.sourceStart, sourceEndIndex: sourceEnd });
    sourceEnd = step.sourceStart;
    targetEnd = step.targetStart;
  }
  return pairs;
}
