import katex from 'katex';

import type { SegmentType } from '@/shared/types/domain';

export function normalizeMathMarkdown(value: string, segmentType?: SegmentType) {
  if (segmentType === 'code') {
    return value;
  }

  if (segmentType === 'math') {
    return normalizeDisplayMathMarkdown(value);
  }

  const input = stripBrokenParagraphMath(value);
  const normalized = input
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `\n$$${body.trim()}$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body.trim()}$`);
  const repaired = promoteLongInlineMath(
    repairLooseInlineMath(wrapBareLatexFragments(repairBracketedDisplayMath(normalized)))
  );

  if (
    !containsMathDelimiter(repaired) &&
    looksLikeStandaloneLatex(repaired)
  ) {
    return `$$\n${repaired}\n$$`;
  }

  return repaired;
}

function normalizeDisplayMathMarkdown(value: string) {
  const body = unwrapDisplayMathDelimiters(value.trim());
  const normalized = normalizeMineruMathContent(body);
  return normalized ? `$$\n${normalized}\n$$` : '';
}

function unwrapDisplayMathDelimiters(value: string) {
  const dollarMatch = value.match(/^\$\$([\s\S]*?)\$\$$/);
  if (dollarMatch) {
    return dollarMatch[1].trim();
  }

  const bracketMatch = value.match(/^\\\[([\s\S]*?)\\\]$/);
  if (bracketMatch) {
    return bracketMatch[1].trim();
  }

  return value;
}

function stripBrokenParagraphMath(value: string) {
  const restore = (body: string, delimiter: string) =>
    isPlausibleParagraphMath(body) ? `${delimiter}${body}${delimiter}` : body;

  return value
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, body: string) => restore(body, '$$'))
    .replace(/\$([^$\n]{1,1200})\$/g, (_match, body: string) => restore(body, '$'))
    .replace(/\$\$/g, '')
    .replace(/\\left\(/g, '(')
    .replace(/\\right\)/g, ')');
}

function isPlausibleParagraphMath(value: string) {
  const compact = value.trim();
  if (!compact || compact.length > 220 || /[.!?]\s+[A-Z]/.test(compact)) {
    return false;
  }

  const words = compact
    .replace(/\\[A-Za-z]+/g, '')
    .match(/[A-Za-z]{3,}/g)?.length ?? 0;
  return words < 4 && looksLikeMathFragment(compact);
}

function repairBracketedDisplayMath(value: string) {
  return splitProtectedMath(value)
    .map((part) => {
      if (isProtectedMathPart(part)) {
        return part;
      }

      return part.replace(/\u3010([\s\S]{1,1400}?)\u3011/g, (match, body: string) => {
        const compacted = compactLooseMathExpression(body);
        return looksLikeMathFragment(compacted) ? `\n$$${compacted}$$\n` : match;
      });
    })
    .join('');
}

function repairLooseInlineMath(value: string) {
  return splitProtectedMath(value)
    .map((part) => {
      if (!part || isProtectedMathPart(part)) {
        return part;
      }
      return repairLooseInlineMathPart(repairVerticalMathFragments(part));
    })
    .join('');
}

function wrapBareLatexFragments(value: string) {
  const withEnvironments = splitProtectedMath(value)
    .map((part) =>
      isProtectedMathPart(part) ? part : wrapBareLatexEnvironments(part)
    )
    .join('');

  return splitProtectedMath(withEnvironments)
    .map((part) =>
      isProtectedMathPart(part) ? part : wrapBareLatexCommandRuns(part)
    )
    .join('');
}

function wrapBareLatexEnvironments(value: string) {
  return value.replace(
    /\\begin\s*\{([A-Za-z*]+)\}[\s\S]*?\\end\s*\{\1\}/g,
    (match: string) => {
      const normalized = normalizeMineruMathContent(match);
      return canRenderLatex(normalized) ? `$${normalized}$` : match;
    }
  );
}

function wrapBareLatexCommandRuns(value: string) {
  const commandPattern = /\\(?:[A-Za-z]+|[^\s])/g;
  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(value))) {
    if (match.index < cursor || !isBareLatexCommand(match[0])) {
      continue;
    }

    const start = findBareLatexStart(value, match.index);
    const maxEnd = findBareLatexEnd(value, match.index + match[0].length);
    const candidate = findRenderableBareLatexCandidate(
      value,
      start,
      maxEnd,
      match.index + match[0].length
    );

    if (!candidate) {
      continue;
    }

    output += value.slice(cursor, start);
    output += `$${candidate.normalized}$`;
    cursor = candidate.end;
    commandPattern.lastIndex = candidate.end;
  }

  return output + value.slice(cursor);
}

function findBareLatexStart(value: string, commandIndex: number) {
  const sentenceBoundary = Math.max(
    value.lastIndexOf('\n', commandIndex - 1),
    value.lastIndexOf('.', commandIndex - 1),
    value.lastIndexOf(';', commandIndex - 1),
    value.lastIndexOf('?', commandIndex - 1),
    value.lastIndexOf('!', commandIndex - 1)
  );
  const boundary = sentenceBoundary >= 0 ? sentenceBoundary + 1 : 0;
  const prefix = value.slice(boundary, commandIndex);
  const mathStart = firstLikelyMathStart(prefix);

  if (mathStart === null) {
    return commandIndex;
  }

  return boundary + mathStart;
}

function firstLikelyMathStart(value: string) {
  const patterns = [
    /(?:^|[\s(])([A-Za-z](?:\s*[_^]\s*(?:\{[^{}]*\}|[A-Za-z0-9]+))+)/,
    /(?:^|[\s(])([A-Za-z]\s*\\\s*[:;,!]\s*=)/,
    /(?:^|[\s(])([A-Za-z]\s*[:=])/,
    /(?:^|[\s(])([A-Z](?=\s*\\(?:in|times|cdot|leq|geq|neq)\b))/
  ];
  const starts = patterns
    .map((pattern) => {
      const match = value.match(pattern);
      if (!match || match.index === undefined) {
        return null;
      }
      return match.index + match[0].indexOf(match[1]);
    })
    .filter((start): start is number => start !== null);

  return starts.length > 0 ? Math.min(...starts) : null;
}

function findBareLatexEnd(value: string, afterCommandIndex: number) {
  let braceDepth = 0;
  let index = afterCommandIndex;

  while (index < value.length) {
    const char = value[index];

    if (char === '$') {
      break;
    }
    if (char === '\n' && braceDepth === 0) {
      break;
    }
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (braceDepth === 0) {
      if (/[.!?]/.test(char) && /^\s+[A-Z]/.test(value.slice(index + 1))) {
        break;
      }
      if (char === ' ' && startsWithProseWord(value.slice(index + 1))) {
        break;
      }
    }

    index += 1;
  }

  while (index > afterCommandIndex && /\s/.test(value[index - 1])) {
    index -= 1;
  }
  return index;
}

function findRenderableBareLatexCandidate(
  value: string,
  start: number,
  maxEnd: number,
  minimumEnd: number
) {
  const ends = candidateEndPositions(value, start, maxEnd, minimumEnd);

  for (const end of ends) {
    const raw = value.slice(start, end).trim();
    const normalized = normalizeMineruMathContent(raw);

    if (
      looksLikeBareLatexCandidate(normalized) &&
      canRenderLatex(normalized)
    ) {
      return { end, normalized };
    }
  }

  return null;
}

function candidateEndPositions(
  value: string,
  start: number,
  maxEnd: number,
  minimumEnd: number
) {
  const candidates = new Set<number>([maxEnd]);
  let braceDepth = 0;

  for (let index = start; index < maxEnd; index += 1) {
    const char = value[index];
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (index <= minimumEnd || braceDepth !== 0) {
      continue;
    }

    if (/[\s,.;:，。；、)]/.test(char)) {
      candidates.add(index);
    }
  }

  return [...candidates]
    .filter((end) => end > minimumEnd)
    .sort((left, right) => right - left)
    .slice(0, 80);
}

function startsWithProseWord(value: string) {
  const match = value.match(/^([A-Za-z]{3,})(?=\s)/);
  return Boolean(match && !isMathTextWord(match[1]));
}

function isMathTextWord(value: string) {
  return /^(?:and|or|in|with|where|for|to|by)$/i.test(value)
    ? false
    : /^(?:mod|log|lim|sin|cos|tan|max|min|arg|dim|rank)$/i.test(value);
}

function isBareLatexCommand(command: string) {
  const name = command.match(/^\\([A-Za-z]+)/)?.[1] ?? '';
  return name ? !/^(?:url|href)$/i.test(name) : /^\\[^\s]$/.test(command);
}

function looksLikeBareLatexCandidate(value: string) {
  if (!value || containsMathDelimiter(value) || !/\\[A-Za-z]+/.test(value)) {
    return false;
  }

  const mathSignals = value.match(
    /\\[A-Za-z]+|[_^=+\-*/:]|\\begin\s*\{|\\end\s*\{|\{[^{}]*\}/g
  ) ?? [];
  if (mathSignals.length === 0) {
    return false;
  }

  const proseWords = value
    .replace(/\\[A-Za-z]+(?:\s*\{[^{}]*\})?/g, ' ')
    .replace(/[{}_^=+\-*/:]/g, ' ')
    .match(/[A-Za-z]{3,}/g) ?? [];

  return proseWords.length <= Math.max(6, mathSignals.length * 2);
}

function canRenderLatex(value: string, displayMode = false) {
  try {
    katex.renderToString(value, {
      displayMode,
      strict: false,
      throwOnError: true
    });
    return true;
  } catch {
    return false;
  }
}

function repairLooseInlineMathPart(value: string) {
  const mathAtom = String.raw`(?:\\[A-Za-z]+|[A-Za-z\u0370-\u03ff][A-Za-z0-9']*)`;
  const braceBody = String.raw`(?:[^{}\n]|\\[A-Za-z]+\s*\{\s*[^{}\n]*\s*\}|\{\s*[^{}\n]*\s*\})+?`;
  const looseSubSupPattern = new RegExp(
    String.raw`(^|[^$\\\w\u0370-\u03ff])(${mathAtom}(?:\s*[_^]\s*\{\s*${braceBody}\s*\})+)`,
    'g'
  );

  return value.replace(
    looseSubSupPattern,
    (_match, prefix: string, expression: string) =>
      `${prefix}$${compactLooseMathExpression(expression)}$`
  );
}

function repairVerticalMathFragments(value: string) {
  const mathAtom = String.raw`[A-Za-z\u0370-\u03ff]`;
  const duplicateVerticalPattern = new RegExp(
    String.raw`(^|[^$\\\w\u0370-\u03ff])(${mathAtom})\s*\n\s*([A-Za-z0-9])\s*\n\s*\2?\s*(?:[\u200b\u200c\u200d\ufeff]\s*)?`,
    'g'
  );
  const verticalPattern = new RegExp(
    String.raw`(^|[^$\\\w\u0370-\u03ff])(${mathAtom})\s*\n\s*([A-Za-z0-9])(?=\s|[，。；,.);]|$)`,
    'g'
  );

  return value
    .replace(
      new RegExp(
        String.raw`(^|[^$\\\w\u0370-\u03ff])(${mathAtom})\s*\n\s*([A-Za-z0-9])\s*\n\s*\2\s*\n\s*\3(?:\s*[\u200b\u200c\u200d\ufeff])?`,
        'g'
      ),
      (_match, prefix: string, base: string, subscript: string) =>
        `${prefix}$${compactLooseMathExpression(`${base}_{${subscript}}`)}$`
    )
    .replace(
      duplicateVerticalPattern,
      (_match, prefix: string, base: string, subscript: string) =>
        `${prefix}$${compactLooseMathExpression(`${base}_{${subscript}}`)}$`
    )
    .replace(
      verticalPattern,
      (_match, prefix: string, base: string, subscript: string) =>
        `${prefix}$${compactLooseMathExpression(`${base}_{${subscript}}`)}$`
    );
}

function promoteLongInlineMath(value: string) {
  return value.replace(/\$([^$\n]{64,})\$/g, (match, body: string) =>
    shouldPromoteInlineMath(body) ? `\n$$${compactLooseMathExpression(body)}$$\n` : match
  );
}

function shouldPromoteInlineMath(value: string) {
  if (looksLikeProseBetweenInlineMath(value)) {
    return false;
  }

  return (
    (value.length > 92 && looksLikeMathFragment(value)) ||
    /\\(?:left|right|rightarrow|Rightarrow|tag|begin|frac|sum|prod|int)\b/.test(value)
  );
}

function looksLikeProseBetweenInlineMath(value: string) {
  const withoutLatexCommands = value
    .replace(/\\[A-Za-z]+(?:\s*\{[^{}]*\})?/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ');
  const proseWords = withoutLatexCommands.match(/[A-Za-z]{3,}/g) ?? [];
  const mathTokens =
    value.match(/[=+\-*/_^{}]|\b(?:sum|prod|int|frac|sqrt|left|right|softmax)\b/g) ?? [];

  return proseWords.length >= 5 && proseWords.length > mathTokens.length;
}

function normalizeMineruMathContent(value: string) {
  return repairVerticalMathAtomsInExpression(value)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/([\u0370-\u03ff])/g, (match: string) => greekLatexName(match) ?? match)
    .replace(/\\\s+([A-Za-z,;:!])/g, '\\$1')
    .replace(/\\([A-Za-z]+)\s+\{/g, '\\$1{')
    .replace(/(\\begin\{[A-Za-z*]+\})\s+\{/g, '$1{')
    .replace(
      /\\(mathrm|mathit|mathbf|mathcal|mathbb|mathtt|mathsf|operatorname|text|textbf|textit|textrm|textsf|texttt)\s*\{\s*([^{}]+?)\s*\}/g,
      (_match, command: string, body: string) => {
        const normalizedBody = isLatexTextCommand(command)
          ? body.replace(/\s+/g, ' ').trim()
          : body.trim();
        return `\\${command}{${normalizedBody}}`;
      }
    )
    .replace(
      /\{\s*(\\(?:mathrm|mathit|mathbf|mathcal|mathbb|mathtt|mathsf|operatorname|text|textbf|textit|textrm|textsf|texttt)\{[^{}]*\})\s*\}/g,
      '{$1}'
    )
    .replace(/\s*\\tag\s*\{\s*([^{}]+?)\s*\}/g, (_match, body: string) => `\\tag{${body.trim()}}`)
    .replace(/\s*([_^])\s*/g, '$1')
    .replace(/\{\s*([^{}]+?)\s*\}/g, (_match, body: string) => `{${body.trim()}}`)
    .replace(/\s*([,:;=+\-*/])\s*/g, '$1')
    .replace(/\s*(\\(?:rightarrow|Rightarrow|leftarrow|in|notin|geq|leq|neq))\s*/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function compactLooseMathExpression(value: string) {
  return normalizeMineruMathContent(value);
}

function isLatexTextCommand(command: string) {
  return /^(?:operatorname|text|textbf|textit|textrm|textsf|texttt)$/.test(command);
}

function repairVerticalMathAtomsInExpression(value: string) {
  const projectionSuperscriptLinePattern =
    /(^|[^A-Za-z0-9_\\])(W)\s*\n\s*([A-Z])\s*(?:\n\s*\2\s*\n?\s*\3)?(?=\s|[\\,.;:)=+\-*/]|$)/g;
  const projectionSuperscriptSpacePattern =
    /(^|[^A-Za-z0-9_\\])(W)\s+([A-Z])\s+\2\s+\3(?=\s|[\\,.;:)=+\-*/]|$)/g;
  const duplicateLinePattern =
    /(^|[^\w\u0370-\u03ff\\])([A-Za-z\u0370-\u03ff])\s*\n\s*([A-Za-z0-9])\s*\n\s*\2\s*\n\s*\3(?=\s|[\\,.;:)=+\-*/]|$)/g;
  const duplicateSpacePattern =
    /(^|[^\w\u0370-\u03ff\\])([A-Za-z\u0370-\u03ff])\s+([A-Za-z0-9])\s+\2\s+\3(?=\s|[\\,.;:)=+\-*/]|$)/g;
  const singleLinePattern =
    /(^|[^\w\u0370-\u03ff\\])([A-Za-z\u0370-\u03ff])\s*\n\s*([A-Za-z0-9])(?=\s|[\\,.;:)=+\-*/]|$)/g;

  return value
    .replace(
      projectionSuperscriptLinePattern,
      (_match, prefix: string, base: string, superscript: string) =>
        `${prefix}${base}^{${superscript}}`
    )
    .replace(
      projectionSuperscriptSpacePattern,
      (_match, prefix: string, base: string, superscript: string) =>
        `${prefix}${base}^{${superscript}}`
    )
    .replace(
      duplicateLinePattern,
      (_match, prefix: string, base: string, subscript: string) =>
        `${prefix}${base}_{${subscript}}`
    )
    .replace(
      duplicateSpacePattern,
      (_match, prefix: string, base: string, subscript: string) =>
        `${prefix}${base}_{${subscript}}`
    )
    .replace(
      singleLinePattern,
      (_match, prefix: string, base: string, subscript: string) =>
        `${prefix}${base}_{${subscript}}`
    );
}

function splitProtectedMath(value: string) {
  return value.split(/(`[^`]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g);
}

function isProtectedMathPart(value: string) {
  return value.startsWith('`') || value.startsWith('$');
}

function looksLikeMathFragment(value: string) {
  return (
    /\\(?:mathrm|mathcal|left|right|tag|frac|sum|prod|int|sqrt|rightarrow|Rightarrow)\b/.test(
      value
    ) ||
    /[_^]\{/.test(value) ||
    /\\mathcal\{/.test(value) ||
    /[=鈫掆噿]/.test(value)
  );
}

function greekLatexName(value: string) {
  const names: Record<string, string> = {
    螒: '\\Alpha',
    螔: '\\Beta',
    螕: '\\Gamma',
    螖: '\\Delta',
    螘: 'E',
    螙: 'Z',
    螚: 'H',
    螛: '\\Theta',
    螜: 'I',
    螝: 'K',
    螞: '\\Lambda',
    螠: 'M',
    螡: 'N',
    螢: '\\Xi',
    螣: 'O',
    螤: '\\Pi',
    巍: 'P',
    危: '\\Sigma',
    韦: 'T',
    违: '\\Upsilon',
    桅: '\\Phi',
    围: 'X',
    唯: '\\Psi',
    惟: '\\Omega',
    伪: '\\alpha',
    尾: '\\beta',
    纬: '\\gamma',
    未: '\\delta',
    蔚: '\\epsilon',
    味: '\\zeta',
    畏: '\\eta',
    胃: '\\theta',
    喂: '\\iota',
    魏: '\\kappa',
    位: '\\lambda',
    渭: '\\mu',
    谓: '\\nu',
    尉: '\\xi',
    慰: 'o',
    蟺: '\\pi',
    蟻: '\\rho',
    蟽: '\\sigma',
    蟿: '\\tau',
    蠀: '\\upsilon',
    蠁: '\\phi',
    蠂: '\\chi',
    蠄: '\\psi',
    蠅: '\\omega'
  };

  return names[value];
}

function containsMathDelimiter(value: string) {
  return /\${1,2}[\s\S]+?\${1,2}/.test(value) || /\\\(|\\\[/.test(value);
}

function looksLikeStandaloneLatex(value: string) {
  if (value.length > 600 || /<table[\s>]/i.test(value) || isMineruImagePath(value)) {
    return false;
  }

  return /\\(?:mathcal|mathrm|left|right|tag|frac|sum|prod|int|sqrt|rightarrow|leq|geq|neq|alpha|beta|gamma|delta|lambda|theta|infty)\b/.test(
    value
  );
}

export function isMineruImagePath(value: string) {
  return /^(?:images[\\/])?[^"'()<>\s]+\.(?:png|jpe?g|webp|gif)$/i.test(value.trim());
}

