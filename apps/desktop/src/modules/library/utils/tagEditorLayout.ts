import type { TagNode } from './tagTree';

export const TAG_NODE_WIDTH = 218;
export const TAG_NODE_HEIGHT = 58;
const COLUMN_STEP = 262;
const ROW_STEP = 78;
const LEFT = 24;
const TOP = 46;

export type PositionedTag = { node: TagNode; x: number; y: number; expanded: boolean };
export type TagLink = { from: string; to: string; path: string };

export function layoutTagEditorTree(roots: TagNode[], collapsedIds: ReadonlySet<string>) {
  const nodes: PositionedTag[] = [];
  const links: TagLink[] = [];
  let row = 0;
  let maxDepth = 0;
  const place = (node: TagNode): PositionedTag => {
    maxDepth = Math.max(maxDepth, node.depth);
    const expanded = node.children.length > 0 && !collapsedIds.has(node.id);
    const children = expanded ? node.children.map(place) : [];
    const y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : TOP + row++ * ROW_STEP;
    const positioned = { node, x: LEFT + node.depth * COLUMN_STEP, y, expanded };
    nodes.push(positioned);
    for (const child of children) {
      const startX = positioned.x + TAG_NODE_WIDTH;
      const endX = child.x;
      const middle = (startX + endX) / 2;
      links.push({ from: node.id, to: child.node.id,
        path: `M ${startX} ${y} C ${middle} ${y}, ${middle} ${child.y}, ${endX} ${child.y}` });
    }
    return positioned;
  };
  roots.forEach(root => { place(root); row += .4; });
  return { nodes, links, width: Math.max(520, LEFT + maxDepth * COLUMN_STEP + TAG_NODE_WIDTH + 32),
    height: Math.max(260, TOP + row * ROW_STEP + 28) };
}
