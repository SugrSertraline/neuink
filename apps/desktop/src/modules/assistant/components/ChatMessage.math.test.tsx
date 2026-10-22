// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownMessageContent } from './ChatMessage';

afterEach(cleanup);

// A multiline model response must not absorb the following prose or table.
const explanation = String.raw`**噪声预测损失**[S1]

\[
\min_{\theta}\mathcal L(\mathbf x_0)
=
\mathbb E_{\substack{\boldsymbol\epsilon\sim\mathcal N(\mathbf0,\mathbf I)\\t\sim\mathcal U(1,T)}}
\left\|
\boldsymbol\epsilon-\boldsymbol\epsilon_\theta(\mathbf x_t,t,\mathbf c)
\right\|_2^2
\]

**比较真实噪声和预测噪声。**[S1]

| 符号 | 含义 |
|---|---|
| \(\mathbf x_0\) | 原始序列 |
| \(\|\cdot\|_2^2\) | 平方误差之和 |

- \(t\) 是扩散步骤。

\[
(0.5-0.4)^2+(-1-(-0.8))^2
=\boxed{0.05}
\]

后续说明。[S1]`;

const source = { entry_id: 'example', entry_title: '示例论文', segment_uid: 'loss', page_idx: 1, quote: '噪声预测损失' };

describe('assistant math rendering', () => {
  it('renders multiline bracket math without swallowing the formula header, prose, table or citations', () => {
    const onOpenSource = vi.fn();
    const ui = render(<MarkdownMessageContent content={explanation} sources={[source]} onOpenSource={onOpenSource} streaming={false} />);

    expect(ui.container.querySelector('.katex-error')).toBeNull();
    expect(ui.container.querySelectorAll('.katex-display')).toHaveLength(2);
    const firstMath = ui.container.querySelector('.katex-display annotation')?.textContent;
    expect(firstMath).toContain(String.raw`\min_{\theta}\mathcal L(\mathbf x_0)`);
    expect(firstMath).toContain(String.raw`\\t\sim\mathcal U(1,T)`);
    expect(ui.getByText('比较真实噪声和预测噪声。').tagName).toBe('STRONG');
    expect(ui.getAllByRole('row')).toHaveLength(3);
    expect(ui.getByText('原始序列').closest('td')).toBeTruthy();
    expect(ui.getAllByRole('listitem')).toHaveLength(1);
    expect(ui.getByText('后续说明。')).toBeTruthy();
    const citations = ui.getAllByRole('button', { name: /来源 S1/ });
    expect(citations).toHaveLength(3);
    fireEvent.click(citations[2]);
    expect(onOpenSource).toHaveBeenCalledWith(source);
  });

  it('recovers a complete response after an unfinished streamed formula', () => {
    const props = { sources: [], onOpenSource: vi.fn() };
    const ui = render(<MarkdownMessageContent {...props} content={String.raw`正在推导：\[\frac{`} streaming />);
    expect(ui.container.querySelector('[aria-busy="true"]')).toBeTruthy();
    ui.rerender(<MarkdownMessageContent {...props} content={explanation} streaming={false} />);
    expect(ui.container.querySelector('.katex-error')).toBeNull();
    expect(ui.container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(ui.getByRole('table')).toBeTruthy();
    expect(ui.container.querySelector('[aria-busy]')).toBeNull();
  });

  it('keeps dollar math, inline bracket math, empty content and invalid-math fallback usable', () => {
    const props = { sources: [], onOpenSource: vi.fn(), streaming: false };
    const ui = render(<MarkdownMessageContent {...props} content={String.raw`行内 \(x_0\) 和 $t$。

$$
x_t = x_0 + \epsilon
$$

\[x + }\]

**仍然能读到后文**`} />);
    expect(ui.container.querySelectorAll('.katex')).toHaveLength(3);
    expect(ui.container.querySelectorAll('.katex-display')).toHaveLength(1);
    expect(ui.container.querySelector('.katex-error')).toBeTruthy();
    expect(ui.getByText('仍然能读到后文').tagName).toBe('STRONG');
    ui.rerender(<MarkdownMessageContent {...props} content="" />);
    expect(ui.container.textContent?.trim()).toBe('');
  });
});
