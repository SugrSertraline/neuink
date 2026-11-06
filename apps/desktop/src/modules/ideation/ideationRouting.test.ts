import { expect, it } from 'vitest';
import { crossesNode, routeBetween } from './ideationRouting';
import { nodeHeight } from './ideationLayout';

it('keeps a next-step hint distinct from a semantic link sharing the source card', () => {
  const problem = { x: 80, y: 80 }, slot = { x: 528, y: 80 }, method = { x: 528, y: 438 };
  const nodes = [problem, slot, method];
  const solid = routeBetween(method, problem, nodes);
  const hint = routeBetween(problem, slot, nodes, undefined, -32);
  expect(hint.points[0].y).toBeLessThan(solid.points[solid.points.length - 1].y);
  expect(hint.path).not.toBe('');
  expect(hint.points.every((point, i) => !i || !nodes.some(node => crossesNode(hint.points[i - 1], point, node)))).toBe(true);
  expect(hint.points[0].y).toBeGreaterThan(problem.y);
  expect(hint.points[0].y).toBeLessThan(problem.y + nodeHeight);
});
