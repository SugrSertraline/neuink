import { describe, expect, it } from 'vitest';
import { translatedListItemText } from './listItemTranslation';

describe('list region translation identity', () => {
  const source = '[3] G. Lucassen, The use of user stories\n[17] S. K. McGrath, Stakeholder defined';
  const translation = '[3] 用户故事的使用\n[17] 利益相关者的定义';

  it('matches the printed number independently of column and translation order', () => {
    expect(translatedListItemText('[17] S. K. McGrath, Stakeholder defined', source, translation)).toBe('[17] 利益相关者的定义');
    expect(translatedListItemText('[3] G. Lucassen, The use of user stories', source,
      '[17] 利益相关者的定义\n[3] 用户故事的使用')).toBe('[3] 用户故事的使用');
  });

  it.each(['\\[17\\]', '**[17]**', '［17］', '- [17]', '- **[17]**'])('recognizes the formatted marker %s', marker => {
    expect(translatedListItemText(`${marker} S. K. McGrath, Stakeholder defined`, source, translation)).toBe('[17] 利益相关者的定义');
  });

  it('recovers a missing region marker from its unique source text', () => {
    expect(translatedListItemText('S. K. McGrath,\nStakeholder defined', source, translation)).toBe('[17] 利益相关者的定义');
  });

  it.each([
    '[3] 用户故事的使用',
    '[17] 第一个结果\n[17] 第二个结果',
    '[1] 重新编号第一项\n[2] 重新编号第二项',
    '- 仅有一项',
  ])('does not substitute another entry when translation cannot be matched: %s', text => {
    expect(translatedListItemText('[17] S. K. McGrath, Stakeholder defined', source, text)).toBeNull();
  });

  it('uses source identity for bullet translations with matching item counts', () => {
    expect(translatedListItemText('Second source', '- First source\n- Second source', '- 第一项\n- 第二项')).toBe('- 第二项');
    expect(translatedListItemText('Second source', '- First source\n- Second source', '第一项\n第二项')).toBe('第二项');
  });

  it('rejects ambiguous source items and merged regions', () => {
    expect(translatedListItemText('Same text', '- Same text\n- Same text', '- 第一项\n- 第二项')).toBeNull();
    expect(translatedListItemText(source, source, translation)).toBeNull();
  });

  it('allows a standalone item only when the complete source matches', () => {
    expect(translatedListItemText('Single item', 'Single item', '单独一项')).toBe('单独一项');
    expect(translatedListItemText('Unknown item', 'Single item', '单独一项')).toBeNull();
  });
});
