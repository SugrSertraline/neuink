import { describe, expect, it } from 'vitest';
import { wrapCoverText } from './bookCoverTexture';
describe('cover title wrapping', () => {
  it('preserves CJK and long unbroken identifiers within the available width', () => {
    const title='跨论文证据来源研究LongIdentifierWithNoSpaces';
    const lines=wrapCoverText(title,7,text=>[...text].length);
    expect(lines.join('')).toBe(title); expect(lines.every(line=>[...line].length<=7)).toBe(true);
  });
  it('keeps words together where they fit and ignores blank metadata', () => {
    expect(wrapCoverText('Reading across papers',14,text=>text.length)).toEqual(['Reading across','papers']);
    expect(wrapCoverText('  ',10,text=>text.length)).toEqual([]);
  });
});
