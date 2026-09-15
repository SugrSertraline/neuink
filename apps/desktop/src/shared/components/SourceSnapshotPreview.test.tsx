/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SourceSnapshotPreview } from './SourceSnapshotPreview';

vi.mock('./MermaidDiagramPreview', () => ({
  MermaidDiagramPreview: ({ code }: { code: string }) => (
    <div data-code={code} data-testid="mermaid-preview" />
  ),
}));

describe('SourceSnapshotPreview', () => {
  afterEach(() => cleanup());

  it('keeps multiple HTML tables, captions, intervening text, headers and merged cells intact', () => {
    render(<SourceSnapshotPreview tableDetailEnabled compact markdown={'<p>实验结果</p><table><caption>表一</caption><thead><tr><th colspan="2">模型</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>81</td></tr><tr><td>82</td></tr></tbody></table><p>下面是消融实验</p><table><tr><th>配置</th><th>得分</th></tr><tr><td>B</td><td>73</td></tr></table><p>表后结论</p>'} />);
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);
    expect(screen.getByText('表一')).toBeTruthy();
    expect(screen.getByText('下面是消融实验')).toBeTruthy();
    expect(screen.getByText('表后结论')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '模型' }).getAttribute('colspan')).toBe('2');
    expect(screen.getByRole('cell', { name: 'A' }).getAttribute('rowspan')).toBe('2');
    expect(within(tables[0]).queryByText('73')).toBeNull();
  });

  it('renders math in HTML table cells without losing cell semantics', () => {
    const { container } = render(<SourceSnapshotPreview markdown={'<table><tr><th>表达式</th></tr><tr><td>$x^2 + y^2$</td></tr></table>'} />);
    expect(container.querySelector('td .katex'), container.innerHTML).not.toBeNull();
  });

  it('provides a bounded scroll owner and a full-table viewer without truncating rows', () => {
    const rows = Array.from({ length: 100 }, (_, index) => '| 指标 ' + index + ' | ' + index + ' |').join('\n');
    render(<SourceSnapshotPreview tableDetailEnabled compact markdown={'| 指标 | 得分 |\n| --- | --- |\n' + rows} />);
    expect(screen.getByText('101 行 · 2 列')).toBeTruthy();
    expect(screen.getByRole('region', { name: '表格内容' }).className).toContain('overflow-auto');
    fireEvent.click(screen.getByRole('button', { name: '查看大表' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('row')).toHaveLength(101);
    expect(within(dialog).getByText('指标 99')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭大表' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('does not merge or drop a large collection of tables', () => {
    const markdown = Array.from({ length: 20 }, (_, index) => '<h3>表 ' + index + '</h3><table><tr><th>指标</th></tr><tr><td>结果 ' + index + '</td></tr></table>').join('\n');
    render(<SourceSnapshotPreview tableDetailEnabled markdown={markdown} />);
    expect(screen.getAllByRole('table')).toHaveLength(20);
    expect(screen.getByText('表 19')).toBeTruthy();
    expect(screen.getByText('结果 19')).toBeTruthy();
  });

  it('shows a recoverable image failure', () => {
    render(<SourceSnapshotPreview imageDetailEnabled imageFillWidth markdown="" previewMode="original" relatedImagePath="https://example.com/plot.png" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('status').textContent).toContain('图片无法读取');
    fireEvent.click(screen.getByRole('button', { name: '重试图片' }));
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('renders Mermaid code fences as diagrams in parsed PDF previews', () => {
    render(
      <SourceSnapshotPreview
        markdown={'```mermaid\ngraph TD\n  A --> B\n```'}
        previewMode="parsed"
      />,
    );

    expect(screen.getByTestId('mermaid-preview').getAttribute('data-code')).toBe(
      'graph TD\n A --> B',
    );
  });

  it('restricts export preview images to the supplied asset map', () => {
    render(<SourceSnapshotPreview
      assetUrls={{ 'assets/verified.png': 'data:image/png;base64,verified' }}
      markdown={'![本地图片](assets/verified.png)\n\n![外部图片](https://example.com/private.png)\n\n<img src="file:///C:/private.png">\n\n![缺图](missing-asset)'} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,verified');
    expect(screen.getAllByText('图片缺失或不可用，无法预览。')).toHaveLength(3);
  });

  it('uses the latest verified image instead of cached URLs', () => {
    const { rerender } = render(<SourceSnapshotPreview markdown="![原图](assets/figure.png)" assetUrls={{ 'assets/figure.png': 'data:image/png;base64,first' }} />);
    rerender(<SourceSnapshotPreview markdown="![原图](assets/figure.png)" assetUrls={{ 'assets/figure.png': 'data:image/png;base64,second' }} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,second');
  });

  it('keeps Mermaid visible as code when that is the selected export representation', () => {
    render(<SourceSnapshotPreview markdown={'```mermaid\ngraph TD\nA --> B\n```'} mermaidAsCode />);
    expect(screen.queryByTestId('mermaid-preview')).toBeNull();
    expect(screen.getByText(/graph TD/).closest('pre')).not.toBeNull();
  });

  it('renders syntax-free paragraphs through the plain-text fast path', () => {
    render(
      <SourceSnapshotPreview markdown={'这是一段不含任何 Markdown 语法的普通文本。'} />
    );

    expect(
      screen.getByText('这是一段不含任何 Markdown 语法的普通文本。').tagName
    ).toBe('P');
  });

  it('still applies the markdown pipeline to formatted text', () => {
    render(<SourceSnapshotPreview markdown={'**加粗结论**与后续正文'} />);

    expect(screen.getByText('加粗结论').tagName).toBe('STRONG');
  });

  it('can suppress parsed Mermaid diagrams', () => {
    render(
      <SourceSnapshotPreview
        markdown={'```mermaid\ngraph TD\n  A --> B\n```'}
        showMermaidDiagrams={false}
      />
    );

    expect(screen.queryByTestId('mermaid-preview')).toBeNull();
  });

  it('applies a configurable image size and opens image details', () => {
    render(
      <SourceSnapshotPreview
        imageDetailEnabled
        imageSize="compact"
        markdown="![流程图](https://example.com/flow.png)"
      />
    );

    const trigger = screen.getByRole('button', { name: '查看流程图详情' });
    expect(trigger.querySelector('img')?.className).toContain('max-h-48');
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('图片详情')).toBeTruthy();
  });
});
