import { describe, expect, it } from 'vitest';

import { parseListItems } from './ListHoverPreview';
import { translatedListItemText } from './listItemTranslation';

describe('list hover preview text', () => {
  it('selects the translated list item matching the hovered source item', () => {
    const translation = '- 第一项译文\n- 第二项译文\n  第二项补充';

    expect(translatedListItemText('Second', '- First\n- Second', translation)).toBe('- 第二项译文\n第二项补充');
  });

  it('falls back to corresponding non-empty lines when list markers are absent', () => {
    expect(translatedListItemText('Second', '- First\n- Second', '第一项译文\n\n第二项译文')).toBe('第二项译文');
  });

  it('keeps continuation lines attached to their list item', () => {
    expect(parseListItems('1. First\ncontinued\n2. Second')).toEqual([
      { marker: '1.', text: 'First\ncontinued' },
      { marker: '2.', text: 'Second' },
    ]);
  });
});
