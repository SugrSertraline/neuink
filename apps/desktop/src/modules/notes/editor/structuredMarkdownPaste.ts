import type { Editor } from '@tiptap/core';

export type StructuredPasteKind = 'block-math' | 'image' | 'inline-math' | 'mermaid' | 'table';

type TableData = {
  rows: string[][];
  withHeaderRow: boolean;
};

export function insertStructuredMarkdownPaste(
  editor: Editor,
  text: string,
  html: string | null = null,
): StructuredPasteKind | null {
  const normalized = text.trim();
  const mermaidCode = mermaidDiagramCode(normalized);
  if (mermaidCode !== null) {
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'mermaidDiagram', attrs: { code: mermaidCode } },
        { type: 'paragraph' },
      ])
      .run();
    return 'mermaid';
  }
  const table = tableFromHtml(html) ?? tableFromText(normalized);
  if (table) {
    editor
      .chain()
      .focus()
      .insertContent([
        tableContent(table.rows, table.withHeaderRow),
        { type: 'paragraph' },
      ])
      .run();
    return 'table';
  }

  const image = markdownImage(normalized);
  if (image) {
    editor.chain().focus().setImage(image).run();
    return 'image';
  }

  const blockLatex = blockMathLatex(normalized);
  if (blockLatex !== null) {
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'blockMath', attrs: { latex: blockLatex } },
        { type: 'paragraph' },
      ])
      .run();
    return 'block-math';
  }

  const inlineLatex = inlineMathLatex(normalized);
  if (inlineLatex !== null) {
    editor
      .chain()
      .focus()
      .insertContent({ type: 'inlineMath', attrs: { latex: inlineLatex } })
      .run();
    return 'inline-math';
  }

  return null;
}

export function mermaidDiagramCode(text: string) {
  const match = text.match(/^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  return match ? match[1].trim() : null;
}

export function tableFromText(text: string): TableData | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  if (lines.length >= 2 && isMarkdownTableSeparator(lines[1]) && lines[0].includes('|')) {
    const header = markdownTableCells(lines[0]);
    const body = lines.slice(2).map(markdownTableCells).filter((row) => row.length > 0);
    if (header.length < 1) {
      return null;
    }
    return {
      rows: [header, ...body].map((row) => normalizeRow(row, header.length)),
      withHeaderRow: true,
    };
  }

  if (lines.some((line) => line.includes('\t'))) {
    const rows = lines.map((line) => line.split('\t').map((cell) => cell.trim()));
    return normalizeTable(rows, false);
  }

  if (lines.length >= 2 && lines.every((line) => csvCellCount(line) >= 2)) {
    return normalizeTable(lines.map(parseCsvRow), false);
  }

  return null;
}

function blockMathLatex(text: string) {
  const dollarMatch = text.match(/^\$\$\s*([\s\S]*?)\s*\$\$$/);
  if (dollarMatch) {
    return dollarMatch[1].trim();
  }
  const bracketMatch = text.match(/^\\\[\s*([\s\S]*?)\s*\\\]$/);
  return bracketMatch ? bracketMatch[1].trim() : null;
}

function inlineMathLatex(text: string) {
  const dollarMatch = text.match(/^\$([^$\n]+)\$$/);
  if (dollarMatch) {
    return dollarMatch[1].trim();
  }
  const bracketMatch = text.match(/^\\\(([^\n]+)\\\)$/);
  return bracketMatch ? bracketMatch[1].trim() : null;
}

function markdownImage(text: string) {
  const match = text.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)$/);
  return match ? { alt: match[1], src: match[2] } : null;
}

function tableFromHtml(html: string | null): TableData | null {
  if (!html || typeof document === 'undefined') {
    return null;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const table = template.content.querySelector('table');
  if (!table) {
    return null;
  }
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(
        (cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ),
    )
    .filter((row) => row.length > 0);
  const withHeaderRow = Boolean(table.querySelector('tr th'));
  return normalizeTable(rows, withHeaderRow);
}

function normalizeTable(rows: string[][], withHeaderRow: boolean): TableData | null {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  if (columnCount === 0) {
    return null;
  }
  return {
    rows: rows.map((row) => normalizeRow(row, columnCount)),
    withHeaderRow,
  };
}

function normalizeRow(row: string[], columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? '');
}

function isMarkdownTableSeparator(line: string) {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownTableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function csvCellCount(line: string) {
  return parseCsvRow(line).length;
}

function parseCsvRow(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  cells.push(current.trim());
  return cells;
}

function tableContent(rows: string[][], withHeaderRow: boolean) {
  return {
    type: 'table',
    content: rows.map((row, rowIndex) => ({
      type: 'tableRow',
      content: row.map((text) => ({
        type: withHeaderRow && rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: text ? [{ type: 'text', text }] : [],
          },
        ],
      })),
    })),
  };
}
