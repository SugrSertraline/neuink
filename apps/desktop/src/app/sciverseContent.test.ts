import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAllSciversePaperContent } from './sciverseContent';
import { readSciverseContent } from '../modules/sciverse/api/sciverseApi';

vi.mock('../modules/sciverse/api/sciverseApi', () => ({ readSciverseContent: vi.fn() }));
const read = vi.mocked(readSciverseContent);
beforeEach(() => read.mockReset());

describe('Sciverse content pagination', () => {
  it('prefers the complete response so server-rewritten image references are not split', async () => {
    const text = '![](dt=2026-06-07/ht=08/figure.jpg)\n\n正文';
    read.mockResolvedValue({ text, chars_returned: 0, next_offset: 9000, more: false });
    expect(await readAllSciversePaperContent('paper')).toEqual({ text, truncated: false });
    expect(read).toHaveBeenCalledExactlyOnceWith({ doc_id: 'paper' });
  });

  it('preserves image paths and whitespace across Unicode character slices', async () => {
    const parts = ['中文 🖼\n\n![](dt=2026-06-07/ht', '=08/figure.jpg)\n\n  ', '正文'];
    let offset = 0;
    for (const [index, text] of parts.entries()) {
      const length = Array.from(text).length;
      offset += length;
      read.mockResolvedValueOnce({ text, chars_returned: length, next_offset: offset, more: index < 2 });
    }
    expect(await readAllSciversePaperContent('paper')).toEqual({ text: parts.join(''), truncated: false });
    expect(read).toHaveBeenNthCalledWith(2, { doc_id: 'paper', limit: 16_000, offset: Array.from(parts[0]).length });
  });
  it('rejects non-advancing pagination instead of repeating source images', async () => {
    read.mockResolvedValue({ text: 'body', chars_returned: 4, next_offset: 0, more: true });
    await expect(readAllSciversePaperContent('paper')).rejects.toThrow('分页未推进');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
