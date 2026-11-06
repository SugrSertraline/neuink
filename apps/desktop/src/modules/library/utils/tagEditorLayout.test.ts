import { expect, it } from 'vitest';
import { layoutTagEditorTree } from './tagEditorLayout';
import type { TagNode } from './tagTree';

const child: TagNode = { id: 'child', name: '子标签', parentId: 'root', path: '根/子标签', depth: 1, count: 1, children: [] };
const root: TagNode = { id: 'root', name: '根', parentId: null, path: '根', depth: 0, count: 1, children: [child] };

it('positions visible children to the right and removes their links when collapsed', () => {
  const open = layoutTagEditorTree([root], new Set());
  expect(open.nodes).toHaveLength(2);
  expect(open.nodes.find(item => item.node.id === 'child')!.x).toBeGreaterThan(open.nodes.find(item => item.node.id === 'root')!.x);
  expect(open.links).toHaveLength(1);
  const closed = layoutTagEditorTree([root], new Set(['root']));
  expect(closed.nodes.map(item => item.node.id)).toEqual(['root']);
  expect(closed.links).toHaveLength(0);
});
