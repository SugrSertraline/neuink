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
      if (close >= 0 && depth > 0) {
        const math = source.slice(cursor + delimiter[0].length, close);
        const unmatchedClosing = (math.match(/[)）]/g)?.length ?? 0) - (math.match(/[(（]/g)?.length ?? 0);
        depth = Math.max(0, depth - Math.max(0, unmatchedClosing));
      }
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
      const footnote = source.slice(end).match(/^(?:\s*<sup(?:\s[^>]*)?>[^<]*<\/sup>)+/i)?.[0];
      if (footnote) end += footnote.length;
      const next = source[end];
      const boundary = translated || next === undefined || /\s/.test(next) ||
        (tightPdfBoundary && /[A-Z]/.test(next));
      const captionNumber = character === '.' && /^(?:(?:(?:Table|Figure|Step)\s+|Fig\.\s*)|(?:[表图]|步骤)\s*)\d+[a-z]?$/i.test(source.slice(start, cursor).trim());
      if (boundary && !captionNumber && (character !== '.' || !isAbbreviation(source.slice(0, cursor)))) {
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

function withoutUrls(text: string, counterpart = '') {
  return normalizeNumericNotation(text, counterpart).replace(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'*+,;=%-]+/gi, ' ')
    .replace(/(\d{1,2})世纪(\d{2})年代/g, (_, century: string, decade: string) =>
      `${(Number(century) - 1) * 100 + Number(decade)}s`);
}

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
function normalizeNumericNotation(text: string, counterpart: string) {
  // Comma groups can also be lists (96, 192, 336). Only collapse a thousands
  // spelling when the other side contains the same grouped or ungrouped value.
  const counterpartNumbers = new Set([...counterpart.matchAll(/(?<![\w.])\d+(?:,\s*\d+)*(?:\.\d+)?/g)]
    .map(match => match[0].replace(/[,\s]/g, '')));
  return text.replace(/（/g, '(').replace(/）/g, ')')
    // OCR/export sometimes repeats a parenthetical year immediately before the
    // full author-year citation. Only remove that demonstrably redundant copy.
    .replace(/\((\d{4}[a-z]?)\)\s*(?=\([^()]*\p{L}[^()]*[,，]\s*\1\))/gu, '')
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[,，]\s*|\s+)(\d{4})\b/gi,
      (_, month: string, day: string, year: string) => `${year} ${MONTHS[month.toLowerCase()]} ${Number(day)}`)
    .replace(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/gi,
      (_, day: string, month: string, year: string) => `${year} ${MONTHS[month.toLowerCase()]} ${Number(day)}`)
    .replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (_, year: string, month: string, day: string) => `${year} ${Number(month)} ${Number(day)}`)
    .replace(/(?<![\w.])\d+(?:,\s*\d+)+(?:\.\d+)?/g, value =>
      /^\d{1,3}(?:,\s*\d{3})+(?:\.\d+)?$/.test(value) && counterpartNumbers.has(value.replace(/[,\s]/g, '')) ? value.replace(/[,\s]/g, '') : value)
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, '$1')
    .replace(/\b([123])[- ]?[dD]\b/g, '$1 dimension')
    .replace(/\b(one|two|three)[- ]?dimensional\b/gi, (_, value: string) => `${ENGLISH_NUMBERS[value.toLowerCase()]} dimension`)
    .replace(/(?<!单)([一二三123])维(?!度)/g, (_, value: string) => `${'一二三'.includes(value) ? '一二三'.indexOf(value) + 1 : value} dimension`)
    .replace(/[一二三四五六七八九](?=年级)/g, value => String('一二三四五六七八九'.indexOf(value) + 1))
    .replace(/(?<![\w.])(\d+(?:\.\d+)?)\s*([Tt]housand|[Mm]illion|[Bb]illion|[KMB](?![a-zA-Z])|万|亿|千)/g,
      (_, value: string, unit: string) => scaleNumericToken(value, { thousand: 3, million: 6, billion: 9,
        k: 3, m: 6, b: 9, 万: 4, 亿: 8, 千: 3 }[unit.toLowerCase()] ?? 0))
    .replace(/\b(\d+(?:\.\d+)?)(?:GB|GHz|MHz|MB|ms|kg|cm|mm|km|G)(?![a-zA-Z])/g, '$1 ');
}

const NUMERIC_TOKEN = /\b\d+(?:\.\d+)?[a-z]?\b/gi;

function canonicalNumericToken(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value.toLowerCase();
  const [whole, fraction = ''] = value.split('.');
  const tail = fraction.replace(/0+$/, '');
  return whole.replace(/^0+(?=\d)/, '') + (tail ? `.${tail}` : '');
}

function scaleNumericToken(value: string, power: number) {
  const [whole, fraction = ''] = value.split('.');
  const digits = whole + fraction, index = whole.length + power;
  return canonicalNumericToken(index >= digits.length ? digits + '0'.repeat(index - digits.length)
    : digits.slice(0, index) + '.' + digits.slice(index));
}

function explicitNumericAnchors(text: string, counterpart: string) {
  return [...withoutUrls(text, counterpart).matchAll(NUMERIC_TOKEN)].map(match => canonicalNumericToken(match[0]));
}

/** Treat 5X as a multiplier only when the other text explicitly says 5倍/5×.
 * Keep algebraic suffixes and identifiers strict when that evidence is absent. */
function normalizeMultiplierAnchors(text: string, counterpart: string) {
  const multipliers = new Set([...counterpart.matchAll(/(?<![\w.])\d+(?:\.\d+)?\s*(?:倍|×)/g)]
    .map(match => match[0].match(/^\d+(?:\.\d+)?/)![0]));
  return text.replace(/\b(\d+(?:\.\d+)?)[xX](?=$|[\s,.;:!?，。；）)])/g,
    (token, number: string) => multipliers.has(number) ? number : token);
}

/** Explicit source digits are required; spelled-out numbers may explain digits introduced by translation. */
function matchingNumericAnchors(source: string, translation: string) {
  const originalSource = source;
  source = normalizeMultiplierAnchors(source, translation);
  translation = normalizeMultiplierAnchors(translation, originalSource);
  const sourceTokens = [...withoutUrls(source, translation).matchAll(/\b(?:\d+(?:\.\d+)?[a-z]?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi)]
    .map(match => {
      const word = match[0].toLowerCase();
      return { value: ENGLISH_NUMBERS[word] ?? canonicalNumericToken(word), optional: word in ENGLISH_NUMBERS };
    });
  const targetDigits = explicitNumericAnchors(translation, source);
  // Translation may reorder clauses inside a sentence (e.g. a five-point scale
  // before its two scores). Compare a multiset, retaining duplicate counts.
  const remaining = new Map<string, number>();
  for (const value of targetDigits) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  for (const token of sourceTokens.filter(token => !token.optional)) {
    const count = remaining.get(token.value) ?? 0;
    if (!count) return false;
    remaining.set(token.value, count - 1);
  }
  for (const token of sourceTokens.filter(token => token.optional)) {
    const count = remaining.get(token.value) ?? 0;
    if (count) remaining.set(token.value, count - 1);
  }
  return [...remaining.values()].every(count => count === 0);
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
          const headingJoin = /^[A-Za-z][A-Za-z -]{2,40}\.$/.test(original[sourceStart]) && original[sourceStart].split(/\s+/).length <= 5 && original[sourceStart + 1]?.length > 20 && /^[^。！？:：]{2,20}[:：]/.test(text);
          if (sourceEnd > sourceStart + 1 && !headingJoin && (sourceText.length < 80 || text.length < 30)) continue;
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

/** Read-only audit reasons describe local alignment constraints, not translation quality verdicts. */
export function sentenceAlignmentFailureReason(source: string, translation: string) {
  const original = splitAcademicSentences(source), fragments = splitAcademicSentences(translation, true);
  if (!original.length || !fragments.length) return 'empty';
  if (original.length > 30 || fragments.length > 80) return 'limit';
  if (!matchingNumericAnchors(source, translation)) return 'numeric_mismatch';
  return 'sentence_structure';
}
