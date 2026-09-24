import { describe, expect, it } from 'vitest';
import { assertInlineNoteCitations } from './noteCitations';
import { buildNoteProposal } from './toolSupport';

const context = {
  availableEntries: [],
  currentEntry: { id: 'entry', title: 'Paper' },
  readNoteSnapshots: new Map([['entry:note', { markdown: 'Old', title: 'Note' }]]),
  scope: { entry_ids: ['entry'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] },
  sourceByMarker: new Map([[1, {
    entry_id: 'entry', entry_title: 'Paper', page_idx: 0, quote: '42 participants', segment_uid: 'segment'
  }]])
};

describe('inline note citations', () => {
  it.each([
    '试验纳入 42 人 [S1]。\n\n局限性见下一节。',
    '- 试验 [S1]。\n- 复核 [S1]。',
    '| 人数 | 42 [S1] |',
    '> 原文结论 [S1]。',
    '42 [S1]'
  ])('preserves citations at their content positions: %s', markdown => {
    expect(() => assertInlineNoteCitations(markdown, ['S1'])).not.toThrow();
  });

  it.each([
    '正文没有引用。',
    '正文。\n\n[S1]',
    '正文。\n\n- [S1]',
    '正文。\n\n1. [S1]',
    '正文。\n\n[S1][S2]',
    '```md\n内容 [S1]\n```',
    '~~~~md\n内容 [S1]\n~~~~',
    '示例代码 `[S1]`',
    '有效引用 [S1]。\n\n[S1]'
  ])('rejects unplaced/code-only/standalone citations: %s', markdown => {
    expect(() => assertInlineNoteCitations(markdown, ['S1'])).toThrow(/inline|separate line/);
  });

  it('allows general notes without sources', () => {
    expect(() => assertInlineNoteCitations('自己的待办。', [])).not.toThrow();
  });

  it('rejects the metadata-only proposal that previously produced a footer pile', () => {
    expect(() => buildNoteProposal({ action: 'create', markdown: '试验纳入 42 人。', source_markers: ['S1'] }, context))
      .toThrow('no inline citation');
  });

  it('infers inline sources, retaining repeated citation positions', () => {
    const markdown = '第一项结论 [S1]。\n\n第二项结论 [S1]。';
    const proposal = buildNoteProposal({ action: 'create', markdown }, context);
    expect(proposal.markdown).toBe(markdown);
    expect(proposal.afterMarkdown).toBe(markdown);
    expect(proposal.sources).toHaveLength(1);
  });

  it('uses authoritative patch text rather than a human-readable preview', () => {
    const input = { action: 'patch', note_id: 'note', markdown: '修改摘要', patch_operations: [
      { type: 'replace_exact', old_text: 'Old', new_text: '新结论 [S1]。' }
    ] };
    const proposal = buildNoteProposal(input, context);
    expect(proposal.sources[0].marker).toBe('S1');
    expect(proposal.afterMarkdown?.trimEnd()).toBe('新结论 [S1]。');
    expect(() => buildNoteProposal({ ...input, markdown: '摘要 [S1]', source_markers: ['S1'],
      patch_operations: [{ type: 'replace_exact', old_text: 'Old', new_text: '未引用的结论' }]
    }, context)).toThrow('no inline citation');
  });

  it('still rejects fabricated source identifiers', () => {
    expect(() => buildNoteProposal({ action: 'create', markdown: '结论 [S9]。' }, context))
      .toThrow('Unknown evidence marker');
  });
});
