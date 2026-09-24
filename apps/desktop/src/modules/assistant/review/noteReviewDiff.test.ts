import { describe, expect, it } from 'vitest';
import { buildNoteReviewDiff, noteReviewVersions } from './noteReviewDiff';
import type { AssistantNoteProposal } from '@/shared/types/assistant';

export const reviewProposal: AssistantNoteProposal = {
  id: 'proposal', entryId: 'entry', entryTitle: '论文', noteId: 'note', title: '研究笔记',
  action: 'replace', beforeMarkdown: '# 摘要\n原结论\n\n## 方法\n原方法\n\n结束。',
  markdown: '# 摘要\n新结论 [S1]\n\n## 方法\n新方法\n\n结束。',
  status: 'pending', createdAt: '', sources: [], targetKind: 'markdown_note'
};

describe('note review diff', () => {
  it('places separate changes in unchanged document context with original line coordinates', () => {
    const versions = noteReviewVersions(reviewProposal);
    expect(buildNoteReviewDiff(versions.before, versions.after)).toEqual([
      { kind: 'context', text: '# 摘要' },
      { kind: 'change', id: 0, before: '原结论', after: '新结论 [S1]', beforeLine: 2, afterLine: 2, beforeCount: 1, afterCount: 1 },
      { kind: 'context', text: '\n## 方法' },
      { kind: 'change', id: 1, before: '原方法', after: '新方法', beforeLine: 5, afterLine: 5, beforeCount: 1, afterCount: 1 },
      { kind: 'context', text: '\n结束。' }
    ]);
  });
  it.each(['create', 'append', 'prepend', 'replace'] as const)('shows %s without changing original proposal', action => {
    const proposal = { ...reviewProposal, action, beforeMarkdown: '原文', markdown: '新文' };
    const original = JSON.stringify(proposal);
    const versions = noteReviewVersions(proposal);
    expect(versions.after).toBe({ create: '新文', append: '原文\n\n新文', prepend: '新文\n\n原文', replace: '新文' }[action]);
    expect(JSON.stringify(proposal)).toBe(original);
  });
  it('uses real patch payload and does not trust a presentation summary or stale afterMarkdown', () => {
    const versions = noteReviewVersions({ ...reviewProposal, action: 'patch', beforeMarkdown: 'A\nB\nC', markdown: '摘要', afterMarkdown: '错误预览',
      patchOperations: [{ type: 'replace_exact', oldText: 'B', newText: 'changed' }] });
    expect(versions.after.trimEnd()).toBe('A\nchanged\nC');
  });
  it('shows complete deletion, empty creation, and no-op distinctly', () => {
    expect(buildNoteReviewDiff('删除', '')[0]).toMatchObject({ kind: 'change', before: '删除', after: '' });
    expect(buildNoteReviewDiff('', '')).toEqual([]);
    expect(buildNoteReviewDiff('原文\r\n', '原文\n')).toEqual([{ kind: 'context', text: '原文' }]);
  });
  it('never guesses a missing base or a mismatched patch target', () => {
    expect(() => noteReviewVersions({ ...reviewProposal, beforeMarkdown: null })).toThrow('原文快照');
    expect(() => noteReviewVersions({ ...reviewProposal, action: 'patch', patchOperations: [{ type: 'replace_exact', oldText: '不存在', newText: 'x' }] })).toThrow();
  });
  it('retains every line of very large changes without an unbounded diff matrix', () => {
    const before = Array.from({ length: 900 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 900 }, (_, i) => `new ${i}`).join('\n');
    expect(buildNoteReviewDiff(before, after)).toEqual([{ kind: 'change', id: 0, before, after, beforeLine: 1, afterLine: 1, beforeCount: 900, afterCount: 900 }]);
  });
  it('reconstructs both sides for repeated lines, additions and deletions', () => {
    for (const [before, after] of [['A\nB\nA', 'A\nA\nC'], ['', 'A\nB'], ['A\nB', 'B'], ['A\nB', 'Z\nA\nY\nB\nX']]) {
      const blocks = buildNoteReviewDiff(before, after);
      for (const side of ['before', 'after'] as const) {
        expect(blocks.map(block => block.kind === 'context' ? block.text : block[side]).filter(Boolean).join('\n')).toBe(side === 'before' ? before : after);
      }
    }
  });
  it('counts an added empty line as an addition instead of a deletion', () => {
    expect(buildNoteReviewDiff('A\nB', 'A\n\nB')[1]).toMatchObject({ kind: 'change', before: '', after: '', beforeCount: 0, afterCount: 1 });
  });
});
