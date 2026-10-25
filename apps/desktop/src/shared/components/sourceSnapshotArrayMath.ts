import katex from 'katex';

/** Repair a damaged OCR array only when every row establishes the same width. */
export function repairOcrArrayMath(value: string) {
  const startPattern = /\\begin\s*\{array\}\s*/g;
  let result = '';
  let cursor = 0;
  for (const match of value.matchAll(startPattern)) {
    if (match.index < cursor) continue;
    const group = readGroup(value, match.index + match[0].length);
    if (!group) continue;
    const spec = group.body.replace(/\s/g, '').replace(/\\_/g, '_');
    // A subscript cannot be a column alignment. Do not guess mixed alignment,
    // custom preambles, or merely unsupported but valid LaTeX syntax.
    if (!/^[clr{}_]+$/.test(spec) || !/_\{[clr]+\}/.test(spec)) continue;
    const alignments = [...new Set(spec.match(/[clr]/g))];
    if (alignments.length !== 1) continue;
    const end = /\\end\s*\{array\}/g;
    end.lastIndex = group.end;
    const close = end.exec(value);
    if (!close) continue;
    const body = value.slice(group.end, close.index);
    if (/\\(?:begin|end|multicolumn|hline|cline|cr)\b/.test(body)) continue;
    const repairedBody = repairArrayEscapes(body);
    const columns = arrayColumnCount(repairedBody);
    if (columns === null) continue;
    const repaired = `\\begin{array}{${alignments[0].repeat(columns)}}${repairedBody}\\end{array}`;
    try {
      katex.renderToString(repaired, { displayMode: true, strict: false, throwOnError: true });
    } catch {
      continue;
    }
    result += value.slice(cursor, match.index) + repaired;
    cursor = close.index + close[0].length;
  }
  return result + value.slice(cursor);
}

function readGroup(value: string, start: number) {
  if (value[start] !== '{') return null;
  let depth = 1;
  for (let i = start + 1; i < value.length; i++) {
    if (value[i] === '\\') { i++; continue; }
    if (value[i] === '{') depth++;
    if (value[i] === '}' && --depth === 0) return { body: value.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

function repairArrayEscapes(value: string) {
  const variables = new Set([...value.matchAll(/(?:^|[&\s])([A-Za-z])(?:\\_|_)\s*\{/g)].map(match => match[1]));
  const rows = value
    // An extra slash before an indexed, repeated cell variable is not a command.
    // Keep command-led rows such as \\\Sigma intact.
    .replace(/(?<!\\)\\{3}([A-Za-z])(?=(?:\\_|_)\s*\{)/g,
      (match, variable: string) => variables.has(variable) ? `\\\\ ${variable}` : match)
    .replace(/(?<!\\)\\{3}[ \t]+(?=\\[A-Za-z]+|[A-Za-z0-9])/g, '\\\\ ');
  let output = '';
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === '\\') {
      const text = rows.slice(i).match(/^\\(?:text(?:bf|it|rm|sf|tt)?|operatorname|mathrm|mathtt)\s*/);
      const group = text ? readGroup(rows, i + text[0].length) : null;
      if (group) {
        output += rows.slice(i, group.end);
        i = group.end - 1;
        continue;
      }
      if (/^\\_\s*\{/.test(rows.slice(i))) { output += '_'; i++; continue; }
      // Consume a command escape atomically, so \\_ is not mistaken for \_.
      if (rows[i + 1]) { output += rows.slice(i, i + 2); i++; continue; }
    }
    output += rows[i];
  }
  return output;
}

function arrayColumnCount(value: string) {
  let depth = 0;
  let columns = 1;
  let rowStart = 0;
  const widths: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') {
      if (value[i + 1] === '\\' && depth === 0) {
        if (!value.slice(rowStart, i).trim()) return null;
        widths.push(columns); columns = 1; rowStart = i + 2;
      }
      i++;
    } else if (char === '{') depth++;
    else if (char === '}') { if (--depth < 0) return null; }
    else if (char === '&' && depth === 0) columns++;
  }
  if (depth !== 0) return null;
  if (value.slice(rowStart).trim()) widths.push(columns);
  return widths.length >= 2 && widths[0] >= 2 && widths.every(width => width === widths[0]) ? widths[0] : null;
}
