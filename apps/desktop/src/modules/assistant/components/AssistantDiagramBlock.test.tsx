// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMermaidSvg } from '@/shared/lib/mermaidRenderer';
import { ChatMessage, MarkdownMessageContent } from './ChatMessage';
import { noteReviewVersions } from '../review/noteReviewDiff';
import type { AssistantNoteProposal } from '@/shared/types/assistant';

vi.mock('@/shared/lib/mermaidRenderer', () => ({ renderMermaidSvg: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const diagram = '```mermaid\nmindmap\n  root((主题))\n    指标\n```';
const sources = [{ entry_id: 'paper', entry_title: '示例论文', segment_uid: 'table', page_idx: 2, quote: '指标为 MAE' }];

describe('assistant diagrams', () => {
  it('renders a persisted tool diagram in chat and reading view without a Mermaid answer fence', async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg role="img" aria-label="结构化图"></svg>');
    const message = { message_id: 'diagram', role: 'assistant' as const, content: '这是方法关系。',
      created_at: '', source_links: sources, parts: [
        { type: 'tool-call' as const, id: 'tool-1', toolName: 'present_diagram', status: 'done' as const },
        { type: 'tool-result' as const, id: 'tool-1', toolName: 'present_diagram', summary: '已生成思维导图',
          diagram: { kind: 'mindmap' as const, title: '方法关系', code: 'mindmap\n  root["方法关系"]', sourceMarkers: [1] }, sourceLinks: sources }
      ] };
    const open = vi.fn();
    const view = render(<ChatMessage message={message} streaming={false} onOpenSource={open} />);
    await waitFor(() => expect(view.getByRole('img', { name: '结构化图' })).toBeTruthy());
    fireEvent.click(view.getByRole('button', { name: '[S1]' }));
    expect(open).toHaveBeenCalledWith(sources[0]);
    view.rerender(<ChatMessage message={message} reading streaming={false} onOpenSource={open} />);
    await waitFor(() => expect(view.getByRole('img', { name: '结构化图' })).toBeTruthy());
  });
  it('waits until streaming finishes, renders the diagram and preserves adjacent source navigation', async () => {
    vi.mocked(renderMermaidSvg).mockResolvedValue('<svg role="img" aria-label="思维导图"></svg>');
    const open = vi.fn();
    const content = `${diagram}\n\n指标来自表格。[S1]`;
    const view = render(<MarkdownMessageContent content={content} streaming sources={sources} onOpenSource={open} />);
    expect(view.getByText(/正在生成图表/)).toBeTruthy();
    expect(renderMermaidSvg).not.toHaveBeenCalled();
    view.rerender(<MarkdownMessageContent content={content} streaming={false} sources={sources} onOpenSource={open} />);
    await waitFor(() => expect(view.getByRole('img', { name: '思维导图' })).toBeTruthy());
    expect(renderMermaidSvg).toHaveBeenCalledOnce();
    fireEvent.click(view.getByRole('button', { name: /来源 S1/ }));
    expect(open).toHaveBeenCalledWith(sources[0]);
    expect(view.container.querySelector('details')?.open).toBe(false);
    view.rerender(<MarkdownMessageContent content={content} streaming={false} sources={sources} onOpenSource={() => {}} />);
    expect(renderMermaidSvg).toHaveBeenCalledOnce();
  });

  it('retains readable source when the diagram cannot render', async () => {
    vi.mocked(renderMermaidSvg).mockRejectedValue(new Error('invalid diagram'));
    const view = render(<MarkdownMessageContent content={diagram} streaming={false} sources={[]} onOpenSource={() => {}} />);
    await waitFor(() => expect(view.getByText(/Mermaid 渲染失败/)).toBeTruthy());
    expect(view.container.querySelector('code')?.textContent).toContain('root((主题))');
  });

  it('keeps regular code blocks as code and does not invoke Mermaid', () => {
    const view = render(<MarkdownMessageContent content={'```ts\nconst a = 1;\n```'} streaming={false} sources={[]} onOpenSource={() => {}} />);
    expect(view.container.querySelector('pre code')?.textContent).toContain('const a = 1;');
    expect(renderMermaidSvg).not.toHaveBeenCalled();
  });

  it('previews an append without replacing the original or altering the diagram source', () => {
    const proposal: AssistantNoteProposal = { id: 'append', entryId: 'paper', entryTitle: '论文', noteId: 'note',
      title: '笔记', action: 'append', status: 'pending', createdAt: '', sources: [],
      beforeMarkdown: '# 原有笔记\n\n保留内容。', markdown: `${diagram}\n\n指标来自表格。[S1]` };
    const result = noteReviewVersions(proposal);
    expect(result.before).toBe(proposal.beforeMarkdown);
    expect(result.after).toBe(`${proposal.beforeMarkdown}\n\n${proposal.markdown}`);
    expect(proposal.status).toBe('pending');
  });
});
