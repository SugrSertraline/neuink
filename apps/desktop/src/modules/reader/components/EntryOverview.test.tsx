// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import { EntryOverview } from './EntryOverview';

afterEach(cleanup);

describe('EntryOverview', () => {
  it('shows the complete title, description, custom fields and hierarchical tag paths', () => {
    const longTitle = '一个需要完整显示而不能被省略的长论文标题：面向复杂科研工作流的统一知识组织方法';
    const onOpenContent = vi.fn();
    const { container, getAllByText, getByRole, getByText } = render(
      <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-1') }}>
        <EntryOverview
          entry={{
            id: 'entry-1',
            contents: [{ kind: 'note', note_id: 'note-1', title: '笔记' }],
            title: longTitle,
            tagIds: ['tag-child'],
            tags: ['研究/人工智能/智能体'],
            fields: {
              description: '第一段描述。\n第二段描述需要保持换行。',
              DOI: '10.1000/example',
              作者: '张三、李四'
            },
            createdAt: '2026-07-01T08:00:00.000Z',
            updatedAt: '2026-07-02T08:00:00.000Z',
            pdfFileName: 'paper.pdf',
            parseMessage: null,
            parseEndpoint: null,
            status: 'Parsed',
            progress: 100
          }}
          onUpdateEntry={async () => undefined}
          onCreatePdfVersion={vi.fn()}
          onOpenContent={onOpenContent}
          sourceBacklinksBySegmentUid={{}}
          tags={[
            { id: 'tag-root', name: '研究', parent_id: null, created_at: '', updated_at: '' },
            { id: 'tag-mid', name: '人工智能', parent_id: 'tag-root', created_at: '', updated_at: '' },
            { id: 'tag-child', name: '智能体', parent_id: 'tag-mid', created_at: '', updated_at: '' }
          ]}
        />
      </ToastContext.Provider>
    );

    expect(getAllByText(longTitle)).toHaveLength(1);
    expect(getAllByText(longTitle).some((element) => element.tagName === 'H1')).toBe(true);
    expect(
      getByText((_, element) =>
        element?.tagName === 'P' &&
        element.textContent === '第一段描述。\n第二段描述需要保持换行。'
      )
    ).toBeTruthy();
    expect(getByText('研究/人工智能/智能体')).toBeTruthy();
    expect(getByText('10.1000/example')).toBeTruthy();
    expect(getByText('张三、李四')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: '打开 PDF' }));
    fireEvent.click(getByRole('button', { name: '打开重排视图' }));
    fireEvent.click(getByRole('button', { name: '查看片段记录' }));
    fireEvent.click(getByRole('button', { name: '查看引用笔记' }));
    expect(onOpenContent.mock.calls).toEqual([
      ['pdf'],
      ['reflow'],
      ['segment-notes'],
      ['source-links']
    ]);
    expect(container.querySelector('.entry-overview')).toBeTruthy();
    expect(container.querySelector('.entry-overview-body')?.className).toContain('overflow-x-hidden');
    expect(container.querySelector('.entry-overview-stats')?.children).toHaveLength(4);
    expect(container.querySelectorAll('.entry-overview-fields')).toHaveLength(2);
    expect(getByText('研究/人工智能/智能体').className).toContain('entry-overview-breakable');
    expect(getByText('10.1000/example').className).toContain('entry-overview-breakable');
    expect(getByRole('button', { name: '创建新版 PDF' })).toBeTruthy();
  });

  it('opens inline editing and returns focus to the overview action after a save', async () => {
    const onUpdateEntry = vi.fn().mockResolvedValue(undefined);
    const view = render(<ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'toast' }}>
      <EntryOverview entry={{ id: 'inline', title: '条目', fields: {}, tagIds: ['tag'], tags: ['旧标签', '新添加标签'], contents: [], pdfFileName: null,
        status: 'No PDF', progress: 0, createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null }}
        onUpdateEntry={onUpdateEntry} sourceBacklinksBySegmentUid={{}} onOpenContent={vi.fn()}
        tags={[{ id: 'tag', name: '旧标签', parent_id: null, created_at: '', updated_at: '' }]} />
    </ToastContext.Provider>);
    expect(view.getByText('新添加标签')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '编辑条目' }));
    expect(view.queryByRole('dialog')).toBeNull();
    fireEvent.change(view.getByLabelText('标题'), { target: { value: '修改后' } });
    fireEvent.click(view.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(view.queryByLabelText('标题')).toBeNull());
    expect(document.activeElement).toBe(view.getByRole('button', { name: '编辑条目' }));
    expect(onUpdateEntry).toHaveBeenCalledWith('inline', { title: '修改后', fields: {}, tagPaths: ['旧标签', '新添加标签'] });
  });
});
