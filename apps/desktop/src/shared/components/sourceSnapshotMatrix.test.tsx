/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceSnapshotPreview } from './SourceSnapshotPreview';
import { normalizeMathMarkdown } from './sourceSnapshotMath';
import { repairOcrArrayMath } from './sourceSnapshotArrayMath';

vi.mock('./MermaidDiagramPreview', () => ({ MermaidDiagramPreview: () => null }));
afterEach(cleanup);

const matrix = String.raw`S=\left[ \begin{array}{c\_{c} c} 0 & S\_{1 2} & S\_{1 3} & \dots & S\_{1 N} \\\S\_{2 1} & 0 & S\_{2 3} & \dots & S\_{2 N} \\\S\_{3 1} & S\_{3 2} & 0 & \dots & S\_{3 N} \\\ \dots & \dots & \dots & \dots & \dots \\\S\_{N 1} & S\_{N 2} & S\_{N 3} & \dots & 0 \end{array} \right]\tag{5}`;

function expectMatrix(container: HTMLElement, count = 1) {
  expect(container.querySelector('.katex-error')).toBeNull();
  expect(container.querySelectorAll('.katex')).toHaveLength(count);
  expect(container.querySelectorAll('.katex-display')).toHaveLength(count);
  const tables = [...container.querySelectorAll('mtable')].filter(table => table.children.length === 5);
  expect(tables).toHaveLength(count);
  for (const table of tables) {
    expect([...table.children].map(row => row.children.length)).toEqual([5, 5, 5, 5, 5]);
    expect(table.children[1].children[0].textContent?.replace(/\s/g, '')).toBe('S21');
    expect(table.querySelectorAll('msub')).toHaveLength(12);
  }
  for (const formula of container.querySelectorAll('.katex')) {
    expect(formula.querySelector('annotation')?.textContent).toMatch(/^S=\\left\[/);
    expect(formula.querySelector('annotation')?.textContent).toContain(String.raw`\right]\tag{5}`);
  }
  expect([...container.querySelectorAll('.tag')].map(tag => tag.textContent)).toEqual(Array(count).fill('(5)'));
}

describe('OCR matrix rendering', () => {
  it.each([
    ['source formula', matrix, 'math' as const],
    ['translated formula', '$$\n' + matrix + '\n$$', 'math' as const],
    ['bare paragraph formula', matrix, 'paragraph' as const],
    ['delimited paragraph formula', '$$\n' + matrix + '\n$$', 'paragraph' as const],
    ['single-line tagged display formula', '$$' + matrix + '$$', 'paragraph' as const],
    ['bracket-delimited formula', String.raw`\[` + matrix + String.raw`\]`, 'paragraph' as const],
    ['multiline bare formula', matrix.replace(/ & /g, ' &\n'), 'paragraph' as const],
  ])('renders a complete five-column matrix in %s', (_label, markdown, segmentType) => {
    const { container } = render(<SourceSnapshotPreview markdown={markdown} segmentType={segmentType} />);
    expectMatrix(container);
  });

  it('repairs the column spec while preserving math commands and literal text escapes', () => {
    const body = String.raw`\begin{array}{c_{c} c} S_{12} & \text{file\_{name}\&value} \\\Sigma_{21} & 0 \end{array}`;
    expect(repairOcrArrayMath(body)).toBe(body.replace('{c_{c} c}', '{cc}'));
  });

  it('keeps source, translation label, and translated equation separate', () => {
    const { container } = render(<SourceSnapshotPreview markdown={matrix + '\n**翻译**\n' + matrix} />);
    expectMatrix(container, 2);
    expect(container.querySelector('strong')?.textContent).toBe('翻译');
  });

  it('preserves valid alignments, command-led rows and literal underscores', () => {
    for (const body of [
      String.raw`\begin{array}{c|r} S_{1 2} & 0 \\\Sigma_{2 1} & \text{file\_{name}}\end{array}`,
      String.raw`\begin{array}{lcr} 1 & 2 & 3 \\ 4 & 5 & 6 \end{array}`,
    ]) {
      const markdown = '$$\n' + body + '\n$$';
      expect(normalizeMathMarkdown(markdown)).toBe(markdown);
      const view = render(<SourceSnapshotPreview markdown={markdown} />);
      expect(view.container.querySelector('.katex-error')).toBeNull();
      view.unmount();
    }
  });

  it.each([
    String.raw`\begin{array}{*{2}{c}} 1 & 2 \\ 3 & 4 \end{array}`,
    String.raw`\begin{array}{c@{\,}c} 1 & 2 \\ 3 & 4 \end{array}`,
    String.raw`\begin{array}{c_{c} c} 1 & 2 \\ 3 & 4 & 5 \end{array}`,
    String.raw`\begin{array}{c_{r} c} 1 & 2 \\ 3 & 4 \end{array}`,
    String.raw`\begin{array}{c_{c} c} \begin{matrix}1 & 2\\3 & 4\end{matrix} & 0 \\ 0 & 1\end{array}`,
    String.raw`\begin{array}{c_{c} c} 1 & 2 \\ 3 & 4`,
  ])('does not guess ambiguous, incomplete or custom arrays: %s', body => {
    expect(repairOcrArrayMath(body)).toBe(body);
  });

  it('does not repair literal code or authored note review content', () => {
    expect(normalizeMathMarkdown(matrix, 'code')).toBe(matrix);
    expect(normalizeMathMarkdown('```latex\n' + matrix + '\n```')).toBe('```latex\n' + matrix + '\n```');
    const { container } = render(<SourceSnapshotPreview markdown={'$$\n' + matrix + '\n$$'} normalization="none" />);
    expect(container.querySelector('.katex-error')).not.toBeNull();
  });
});
