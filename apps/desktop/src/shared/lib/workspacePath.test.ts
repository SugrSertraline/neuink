import { expect, it } from 'vitest';
import { sameWorkspacePath } from './workspacePath';

it.each([
  [String.raw`\\?\E:\NeuInk\data\library`, 'e:/neuink/data/library/', true],
  [String.raw`\\?\UNC\server\share\library`, '//SERVER/share/library/', true],
  [String.raw`\\?\E:\NeuInk\data\library`, String.raw`E:\Other\data\library`, false],
  ['E:/NeuInk/data/library', 'D:/NeuInk/data/library', false],
  ['E:/NeuInk/data/library', 'E:/NeuInk/data/library-other', false],
  ['/home/user/library', '/home/user/Library', false],
  ['/home/user/library/', '/home/user/library', true],
  ['/home/user/library', '/home/user/other/../library', false],
  ['E:/', 'E:', false],
  ['', '/', false],
])('matches event paths %s and %s without weakening library isolation', (left, right, expected) => {
  expect(sameWorkspacePath(left, right)).toBe(expected);
});
