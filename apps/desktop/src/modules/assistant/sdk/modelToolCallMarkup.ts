/** Some providers emit a serialized tool call as text instead of a structured call. */

const BAR = '[|｜]';
const DSML_OPEN = new RegExp(
  `^\\s*<\\s*${BAR}{1,2}\\s*dsml\\s*${BAR}{1,2}\\s*(?:function_)?(?:calls|invoke|parameter)(?:\\s|>|$)`,
  'i',
);
const LEGACY_OPEN = new RegExp(
  `^\\s*<\\s*${BAR}{1,2}\\s*tool▁(?:calls▁begin|call▁begin)\\s*${BAR}`,
  'i',
);
const DSML_TAG = new RegExp(
  `^<\\s*(\\/)?\\s*${BAR}{1,2}\\s*dsml\\s*${BAR}{1,2}\\s*(calls|function_calls|invoke|parameter)\\b(?:\\s[^<>]*)?(>)?`,
  'i',
);
const LEGACY_TAG = new RegExp(
  `^<\\s*(\\/)?\\s*${BAR}{1,2}\\s*tool▁(?:calls▁begin|call▁begin)\\s*${BAR}{1,2}(?:[^<>]*)?(>)?`,
  'i',
);
const DSML_CLOSE = new RegExp(
  `<\\s*\\/\\s*${BAR}{1,2}\\s*(?:dsml\\s*${BAR}{1,2}\\s*(?:function_)?(?:calls|invoke|parameter)|tool▁(?:calls▁begin|call▁begin)\\s*${BAR})`,
  'i',
);

const STREAM_SHAPES = [
  '<｜｜dsml｜｜calls>', '<｜｜dsml｜｜ calls>', '<｜｜dsml｜｜function_calls>', '<｜｜dsml｜｜ function_calls>',
  '<｜｜dsml｜｜invoke>', '<｜｜dsml｜｜ invoke>', '<｜｜dsml｜｜parameter>', '<｜｜dsml｜｜ parameter>',
  '<｜dsml｜calls>', '<｜dsml｜ calls>', '<｜dsml｜function_calls>', '<｜dsml｜ function_calls>',
  '<｜dsml｜invoke>', '<｜dsml｜ invoke>', '<｜dsml｜parameter>', '<｜dsml｜ parameter>',
  '<|dsml|calls>', '<|dsml| calls>', '<|dsml|function_calls>', '<|dsml| function_calls>',
  '<|dsml|invoke>', '<|dsml| invoke>', '<|dsml|parameter>', '<|dsml| parameter>',
  '<||dsml||calls>', '<||dsml|| calls>', '<||dsml||invoke>', '<||dsml|| invoke>',
  '<｜tool▁calls▁begin｜>', '<｜tool▁call▁begin｜>', '<|tool▁calls▁begin|>', '<|tool▁call▁begin|>',
].flatMap(shape => [shape, `</${shape.slice(1)}`]);

export function isRawModelToolCall(text: string): boolean {
  return /^\s*<tool_call(?:\s|>)/i.test(text) || DSML_OPEN.test(text) || LEGACY_OPEN.test(text);
}

export function isPotentialRawModelToolCall(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  if (!trimmed) return true;
  if ('<tool_call'.startsWith(trimmed) || trimmed.startsWith('<tool_call')) return true;
  if (isRawModelToolCall(text)) return true;
  return STREAM_SHAPES.some(shape => shape.startsWith(trimmed));
}

export function hideRawModelToolCall(text: string): string {
  return isRawModelToolCall(text) ? '' : text;
}

/** DSML or legacy tool envelope occupying the start of an unfenced line slice. */
export function matchDsmlSlice(slice: string): { raw: string; closing: boolean; complete: boolean } | null {
  const match = DSML_TAG.exec(slice) ?? LEGACY_TAG.exec(slice);
  if (match) {
    const closing = Boolean(match[1]);
    const complete = match[0].endsWith('>');
    return { raw: match[0], closing, complete };
  }
  const value = slice.toLowerCase();
  if (!value.startsWith('<') || !/[|｜]|tool▁/.test(value)) return null;
  if (!STREAM_SHAPES.some(shape => shape.startsWith(value))) return null;
  return { raw: slice, closing: /^<\s*\//.test(slice), complete: false };
}

export function hasDsmlClose(text: string): boolean {
  return DSML_CLOSE.test(text);
}
