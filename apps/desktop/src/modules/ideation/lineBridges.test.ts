import { expect, it } from 'vitest';
import { addLineBridges } from './lineBridges';
const route = (points: { x: number; y: number }[]) => ({ points, path: '' });
it('adds one bridge at a true crossing without changing routing coordinates', () => {
  const routes = new Map([['a', route([{ x: 0, y: 50 }, { x: 100, y: 50 }])], ['b', route([{ x: 50, y: 0 }, { x: 50, y: 100 }])]]);
  const result = addLineBridges(routes);
  expect(result.get('a')!.path).not.toContain('Q'); expect(result.get('b')!.path).toContain('Q');
  expect(result.get('b')!.points).toBe(routes.get('b')!.points);
});
it('does not bridge shared endpoints or parallel lines', () => {
  const result = addLineBridges(new Map([['a', route([{ x: 0, y: 0 }, { x: 100, y: 0 }])], ['b', route([{ x: 100, y: 0 }, { x: 100, y: 100 }])], ['c', route([{ x: 0, y: 10 }, { x: 100, y: 10 }])]]));
  expect([...result.values()].every(value => !value.path.includes('Q'))).toBe(true);
});
