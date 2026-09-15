// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SourceBacklink } from '../types';
import { SourceLinksSurface } from './SourceLinksSurface';

const backlink: SourceBacklink = {
  anchorId: 'sl-1',
  displayText: '证据',
  linkId: 'link-1',
  noteEntryId: 'note-entry',
  noteEntryTitle: '研究条目',
  noteId: 'note-1',
  noteTitle: '实验记录',
  page: 3,
  segmentType: 'table',
  segmentUid: 'segment-7',
  sourceEntryId: 'source-entry',
  snapshotText: '表格中的关键实验结果显示该方法显著优于基线。'
};

afterEach(cleanup);

describe('SourceLinksSurface', () => {
  it('keeps tag note navigation and the snapshot after the source paper was deleted', () => {
    const onOpenNote = vi.fn(), onOpenEvidence = vi.fn();
    const deleted: SourceBacklink = { ...backlink, noteEntryId: null, noteTarget: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'note' },
      sourceStatus: { entry_id: 'source-entry', segment_uid: 'segment-7', quote_hash: 'hash', status: 'entry_deleted', can_locate: false, message: '原论文已删除' } };
    const result = render(<SourceLinksSurface backlinks={[deleted]} entryTitle="已删除论文" linkedReaderKind={null} onOpenNote={onOpenNote} onOpenEvidence={onOpenEvidence} />);
    expect(result.getByText('原论文已删除 · 保留引用快照')).toBeTruthy();
    expect((result.getByRole('button', { name: '查看证据' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(result.getByRole('button', { name: '打开笔记' })); expect(onOpenNote).toHaveBeenCalledWith(deleted);
    expect(onOpenEvidence).not.toHaveBeenCalled();
  });
  it('shows a stable empty state', () => {
    const result = render(
      <SourceLinksSurface
        backlinks={[]}
        entryTitle="来源文献"
        linkedReaderKind={null}
        onOpenEvidence={vi.fn()}
        onOpenNote={vi.fn()}
      />
    );

    expect(result.getByText('暂无笔记引用')).toBeTruthy();
    expect(result.getByText('从 PDF 或重排视图把原文片段插入笔记并保存后，引用关系会显示在这里。')).toBeTruthy();
    expect(result.queryByRole('button', { name: '查看证据' })).toBeNull();
  });

  it('shows the evidence summary and provides explicit note and evidence actions', () => {
    const onOpenEvidence = vi.fn();
    const onOpenNote = vi.fn();
    const result = render(
      <SourceLinksSurface
        backlinks={[backlink]}
        entryTitle="来源文献"
        linkedReaderKind="reflow"
        onOpenEvidence={onOpenEvidence}
        onOpenNote={onOpenNote}
      />
    );

    expect(result.getByText('实验记录')).toBeTruthy();
    expect(result.getByText('p.3 · 表格')).toBeTruthy();
    expect(result.getByText('“表格中的关键实验结果显示该方法显著优于基线。”')).toBeTruthy();
    fireEvent.click(result.getByRole('button', { name: '打开笔记' }));
    fireEvent.click(result.getByRole('button', { name: '查看证据' }));

    expect(onOpenNote).toHaveBeenCalledWith(backlink);
    expect(onOpenEvidence).toHaveBeenCalledWith(backlink);
    expect(result.getByTitle('在配对的重排视图中定位第 3 页证据')).toBeTruthy();
  });

  it('offers to open the original evidence when no reader is paired', () => {
    const result = render(
      <SourceLinksSurface
        backlinks={[backlink]}
        entryTitle="来源文献"
        linkedReaderKind={null}
        onOpenEvidence={vi.fn()}
        onOpenNote={vi.fn()}
      />
    );

    expect(result.getByTitle('打开原文并定位第 3 页证据')).toBeTruthy();
  });
});
