/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRenderedNoteDiff } from './renderedNoteDiff';
import { NoteDiffContext, NoteDiffLines, NoteRenderedContent } from './NoteDiffLines';
import { renderMermaidSvg } from '@/shared/lib/mermaidRenderer';
import { ChatMessage } from '../components/ChatMessage';
import type { AssistantNoteProposal } from '@/shared/types/assistant';

vi.mock('@/shared/lib/mermaidRenderer', () => ({ renderMermaidSvg: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const diagram = '```mermaid\nmindmap\n  root((研究))\n    预测\n      MAE\n```';
const change = (before: string, after: string) => {
  const block = buildRenderedNoteDiff(before, after).find(item => item.kind === 'change');
  if (!block || block.kind !== 'change') throw new Error('Expected change');
  return block;
};

describe('rendered note changes', () => {
  it('renders both complete diagrams when just one nested node changes, preserving indentation', async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg aria-label="研究导图" role="img"></svg>');
    const next = diagram.replace('MAE', 'RMSE');
    const block = change(`# 研究\n\n${diagram}\n\n结论`, `# 研究\n\n${next}\n\n结论`);
    expect(block.before).toBe(diagram);
    expect(block.after).toBe(next);
    const view = render(<NoteDiffLines block={block} />);
    await waitFor(() => expect(view.getAllByRole('img', { name: '研究导图' })).toHaveLength(2));
    expect(vi.mocked(renderMermaidSvg).mock.calls.map(call => call[1])).toEqual([
      'mindmap\n  root((研究))\n    预测\n      MAE', 'mindmap\n  root((研究))\n    预测\n      RMSE'
    ]);
    expect(view.container.querySelector('pre')).toBeNull();
    expect(view.container.querySelector('[contenteditable]')).toBeNull();
  });

  it('keeps table headers and nested lists with changed cells and children', () => {
    const before = '| 方法 | 指标 |\n| --- | --- |\n| A | 0.5 |\n\n- 任务\n  - 预测';
    const after = before.replace('0.5', '0.6').replace('预测', '分类');
    const view = render(<NoteDiffLines block={change(before, after)} />);
    expect(view.getAllByRole('table')).toHaveLength(2);
    expect(view.getAllByRole('columnheader', { name: '指标' })).toHaveLength(2);
    expect(view.container.querySelectorAll('ul ul')).toHaveLength(2);
    expect(view.container.querySelector('pre')).toBeNull();
  });

  it('renders display formulas and preserves reference definitions as complete versions', () => {
    const before = '# 公式\n\n$$\ny = x^2\n$$\n\n[依据][paper]\n\n[paper]: https://example.org/paper';
    const after = before.replace('x^2', 'x^3');
    const block = change(before, after);
    expect(block.before).toBe(before);
    expect(block.after).toBe(after);
    const view = render(<NoteDiffLines block={block} />);
    expect(view.container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(view.getAllByRole('link', { name: '依据' })).toHaveLength(2);
  });

  it('does not render chopped context while collapsed, and renders all of it when expanded', async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg role="img" aria-label="上下文图"></svg>');
    const view = render(<NoteDiffContext text={`# 标题\n\n${diagram}\n\n未改正文`} />);
    expect(renderMermaidSvg).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: '展开未修改内容' }));
    await waitFor(() => expect(view.getByRole('img', { name: '上下文图' })).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: '收起未修改内容' }));
    expect(view.queryByRole('img')).toBeNull();
  });

  it('shows a diagram error without reverting to source, but retains genuine code blocks', async () => {
    vi.mocked(renderMermaidSvg).mockRejectedValue(new Error('invalid diagram'));
    const view = render(<NoteRenderedContent text={diagram + '\n\n```ts\nconst n = 1;\n```'} />);
    await waitFor(() => expect(view.getByText(/Mermaid 渲染失败/)).toBeTruthy());
    expect(view.container.querySelectorAll('pre code')).toHaveLength(1);
    expect(view.container.querySelector('pre code')?.textContent).toContain('const n = 1');
    expect(view.container.querySelector('code.language-mermaid')).toBeNull();
  });

  it('keeps long code, deletions, creations and whitespace-only edits reviewable', () => {
    const long = '```text\n' + '完整内容\n'.repeat(1000) + '```';
    expect(change('', long).after).toBe(long);
    expect(change(long, '').before).toBe(long);
    expect(change('正文', '正文\n').after).toBe('正文\n');
    expect(buildRenderedNoteDiff('', '')).toEqual([]);
  });

  it('sanitizes executable HTML and handles unavailable images with readable feedback', () => {
    const view = render(<NoteRenderedContent text={'<script>alert(1)</script>\n\n![图](missing.png)'} />);
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.getByText('图片缺失或不可用，无法预览。')).toBeTruthy();
  });

  it('renders setext headings and thematic breaks instead of taking the plain-text shortcut', () => {
    const view = render(<NoteRenderedContent text={'研究标题\n===\n\n正文\n\n---'} />);
    expect(view.getByRole('heading', { name: '研究标题', level: 1 })).toBeTruthy();
    expect(view.getByRole('separator')).toBeTruthy();
  });

  it.each(['markdown_note', 'segment_note'] as const)('renders the %s proposal inside chat without applying it', async targetKind => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg role="img" aria-label="预览导图"></svg>');
    const proposal: AssistantNoteProposal = { id: 'p', entryId: 'entry', entryTitle: '论文', title: '笔记', action: 'append',
      markdown: diagram, beforeMarkdown: '原文', afterMarkdown: `原文\n\n${diagram}`, status: 'pending', createdAt: '', sources: [], targetKind };
    const apply = vi.fn();
    const view = render(<ChatMessage message={{ message_id: 'message', role: 'assistant', created_at: '', content: '请确认', source_links: [] }}
      noteProposals={[proposal]} streaming={false} onOpenSource={vi.fn()} onApplyNoteProposal={apply} />);
    await waitFor(() => expect(view.getByRole('img', { name: '预览导图' })).toBeTruthy());
    expect(view.container.querySelector('code.language-mermaid')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(proposal.status).toBe('pending');
  });

  it('shows an invalid patch preview as an error without crashing the surrounding reply', () => {
    const proposal: AssistantNoteProposal = { id: 'bad', entryId: 'entry', entryTitle: '论文', title: '笔记', action: 'patch',
      markdown: '不能当成正文的摘要', beforeMarkdown: '原文', status: 'pending', createdAt: '', sources: [],
      patchOperations: [{ type: 'replace_exact', oldText: '找不到', newText: '新文' }] };
    const view = render(<ChatMessage message={{ message_id: 'message', role: 'assistant', created_at: '', content: '周围对话保留', source_links: [] }}
      noteProposals={[proposal]} streaming={false} onOpenSource={vi.fn()} />);
    expect(view.getByRole('alert').textContent).toContain('无法预览');
    expect(view.getByText('周围对话保留')).toBeTruthy();
    expect(view.queryByText('不能当成正文的摘要')).toBeNull();
  });
});
