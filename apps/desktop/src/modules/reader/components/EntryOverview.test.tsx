// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryOverview } from './EntryOverview';

afterEach(cleanup);

describe('EntryOverview', () => {
  it('shows the complete title, description, custom fields and hierarchical tag paths', () => {
    const longTitle = '一个需要完整显示而不能被省略的长论文标题：面向复杂科研工作流的统一知识组织方法';
    const { getAllByText, getByText } = render(
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
        sourceBacklinksBySegmentUid={{}}
        tags={[
          { id: 'tag-root', name: '研究', parent_id: null, created_at: '', updated_at: '' },
          { id: 'tag-mid', name: '人工智能', parent_id: 'tag-root', created_at: '', updated_at: '' },
          { id: 'tag-child', name: '智能体', parent_id: 'tag-mid', created_at: '', updated_at: '' }
        ]}
      />
    );

    expect(getAllByText(longTitle)).toHaveLength(2);
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
  });
});
