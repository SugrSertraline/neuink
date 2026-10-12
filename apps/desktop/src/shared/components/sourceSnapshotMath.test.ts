import { describe, expect, it } from 'vitest';

import { normalizeMathMarkdown } from './sourceSnapshotMath';

describe('snapshot math boundaries', () => {
  it('keeps correctly delimited inline and display formulas intact', () => {
    for (const value of [
      String.raw`其中，$q_s(t) \in \mathbb{R}_{\geq 0}$表示工位$s \in \mathcal{S}$的库存量。`,
      String.raw`工位$$s \in { \mathcal { S } }$$的库存量。`,
      '$$\nx = 1\n$$',
      '$$' + 'x + '.repeat(30) + 'y$$',
      String.raw`$\left(x\right)$`,
    ]) expect(normalizeMathMarkdown(value)).toBe(value);
  });

  it('repairs the reported bare commands without swallowing Chinese prose or inventing a subscript', () => {
    const value = '`qs`' + String.raw` ( t ) \in\mathbb{R}\_{\geq0}表示工位$$s \in { \mathcal { S } } .的连续缓冲区库存量（等效产品单位）`;
    expect(normalizeMathMarkdown(value)).toBe(
      '`qs`' + String.raw` ( t ) $\in\mathbb{R}_{\geq0}$表示工位$s\in{\mathcal{S}}$ .的连续缓冲区库存量（等效产品单位）`,
    );
  });

  it('includes a bare lowercase variable next to Chinese in its relation', () => {
    expect(normalizeMathMarkdown(String.raw`工位s \in \mathcal{S}的库存`))
      .toBe(String.raw`工位$s\in\mathcal{S}$的库存`);
  });

  it.each([
    [String.raw`其中，q_s(t) \in \mathbb{R}_{\geq0}表示库存。`, String.raw`其中，$q_s(t)\in\mathbb{R}_{\geq0}$表示库存。`],
    [String.raw`其中，q_s(t) \in R表示库存。`, String.raw`其中，$q_s(t)\in R$表示库存。`],
    [String.raw`工位s \in S的库存。`, String.raw`工位$s\in S$的库存。`],
    [String.raw`工位s \in S且r \in T。`, String.raw`工位$s\in S$且$r\in T$。`],
    [String.raw`当x \geq y时成立。`, String.raw`当$x\geq y$时成立。`],
  ])('keeps a complete bare relation and command boundaries: %s', (source, expected) => {
    expect(normalizeMathMarkdown(source)).toBe(expected);
  });

  it('does not split a long inline formula across paragraphs', () => {
    const source = String.raw`其中，$q_s(t) \in \mathbb{R}_{\geq 0},\quad s \in \mathcal{S},\quad t \in [0,\infty),\quad q_s(t)=\frac{a_s(t)}{b_s(t)}$表示库存。`;
    expect(normalizeMathMarkdown(source)).toBe(source);
  });

  it('does not swallow prose between bracket-delimited formulas', () => {
    const source = String.raw`其中，\(q_s(t) \in \mathbb{R}_{\geq 0}\)表示工位\(s \in \mathcal{S}\)的库存。`;
    expect(normalizeMathMarkdown(source)).toBe(String.raw`其中，$q_s(t) \in \mathbb{R}_{\geq 0}$表示工位$s \in \mathcal{S}$的库存。`);
  });

  it('leaves code samples and code segments untouched', () => {
    const inline = '`' + String.raw`$$x$$ \(y\) \mathbb{R}` + '`';
    const fenced = '```latex\n' + String.raw`$$x$$ \(y\) \mathbb{R}` + '\n```';
    expect(normalizeMathMarkdown(inline)).toBe(inline);
    expect(normalizeMathMarkdown(fenced)).toBe(fenced);
    expect(normalizeMathMarkdown(String.raw`\mathbb{R}`, 'code')).toBe(String.raw`\mathbb{R}`);
  });

  it('keeps empty input and explicit display segments working', () => {
    expect(normalizeMathMarkdown('')).toBe('');
    expect(normalizeMathMarkdown('x = 1', 'math')).toBe('$$\nx=1\n$$');
    expect(normalizeMathMarkdown(String.raw`\text{库存} \geq 0表示下界`))
      .toBe(String.raw`$\text{库存}\geq0$表示下界`);
  });
});
