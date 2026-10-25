// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createRelationPresentation, focusOffsets, frontOpacity } from './relationPresentation';
import type { SceneNode, SceneLink } from './relationSceneData';

function setup(reduced = false, size = { width: 1200, height: 600, scale: 1 }) {
  const media = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => media);
  const nodes: SceneNode[] = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id, degree: 1, x: index * 50, y: (index % 2) * 30, z: index * 90 - 120,
    data: { id, kind: 'tag', title: id, subtitle: '', available: true },
  }));
  const links: SceneLink[] = [
    { source: 'a', target: 'b', data: { id: 'ab', from: 'a', to: 'b', kind: 'hierarchy', evidence: [] } },
    { source: 'b', target: 'c', data: { id: 'bc', from: 'b', to: 'c', kind: 'hierarchy', evidence: [] } },
  ];
  const camera = new PerspectiveCamera(50, 2, .1, 20000), target = new Vector3(20, 15, 0);
  camera.position.set(500, 400, 700); camera.lookAt(target); camera.updateMatrixWorld();
  const changed = vi.fn(), stateChanged = vi.fn();
  const view = createRelationPresentation({ camera, target, nodes: () => nodes, links: () => links,
    size: () => size, changed, stateChanged });
  return { view, nodes, links, camera, target, media, changed, stateChanged };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('relation view presentation', () => {
  it('keeps the rear hemisphere translucent and restores full opacity after rotating around', () => {
    const points = new Map([['front', new Vector3(0, 0, 100)], ['rear', new Vector3(0, 0, -100)], ['middle', new Vector3(50, 0, 0)]]);
    expect(frontOpacity(points, new Vector3(0, 0, 500)).get('rear')).toBe(.24);
    expect(frontOpacity(points, new Vector3(0, 0, 500)).get('front')).toBe(1);
    expect(frontOpacity(points, new Vector3(0, 0, -500)).get('front')).toBe(.24);
    expect(frontOpacity(points, new Vector3(0, 0, -500)).get('rear')).toBe(1);
    expect(frontOpacity(new Map([['only', new Vector3()]]), new Vector3(0, 0, 500)).get('only')).toBe(1);
  });
  it('interpolates into a coplanar neighborhood and exactly restores the original 3D camera', () => {
    const h = setup(), before = JSON.stringify(h.nodes), original = h.camera.position.clone(), target = h.target.clone();
    h.view.select('b'); expect(h.view.mode).toBe('entering');
    vi.advanceTimersByTime(100);
    expect(h.view.sample().flatness).toBeGreaterThan(0); expect(h.view.sample().flatness).toBeLessThan(1);
    vi.advanceTimersByTime(400); expect(h.view.mode).toBe('planar');
    const frame = h.view.sample(), forward = h.camera.position.clone().sub(h.target).normalize();
    const depths = ['a', 'b', 'c'].map(id => frame.positions.get(id)!.dot(forward));
    expect(Math.max(...depths) - Math.min(...depths)).toBeLessThan(.00001);
    expect(frame.opacity.get('d')).toBe(0); expect(JSON.stringify(h.nodes)).toBe(before);
    h.view.select(null); vi.advanceTimersByTime(700);
    expect(h.view.mode).toBe('spatial'); expect(h.camera.position.distanceTo(original)).toBeLessThan(.00001);
    expect(h.target.distanceTo(target)).toBeLessThan(.00001); expect(h.camera.fov).toBe(50);
    h.view.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('retargets rapid selections, pauses while hidden, and cancels all animation work on disposal', () => {
    const h = setup(), original = h.camera.position.clone();
    h.view.select('a'); vi.advanceTimersByTime(60); h.view.select('b'); vi.advanceTimersByTime(50);
    h.view.setActive(false); const atPause = h.view.sample().flatness, position = h.camera.position.clone();
    vi.advanceTimersByTime(1500); expect(h.view.sample().flatness).toBe(atPause);
    expect(h.camera.position.distanceTo(position)).toBeLessThan(.00001);
    h.view.setActive(true); vi.advanceTimersByTime(700); expect(h.view.mode).toBe('planar');
    h.view.select(null); vi.advanceTimersByTime(700); expect(h.camera.position.distanceTo(original)).toBeLessThan(.00001);
    h.view.select('c'); const calls = h.changed.mock.calls.length; h.view.dispose(); vi.advanceTimersByTime(1000);
    expect(h.changed).toHaveBeenCalledTimes(calls); expect(vi.getTimerCount()).toBe(0);
    expect(h.media.removeEventListener).toHaveBeenCalledOnce();
  });
  it('honors reduced motion and retains complete relationship counts for large neighborhoods', () => {
    const h = setup(true); h.view.select('b');
    expect(h.view.mode).toBe('planar'); expect(vi.getTimerCount()).toBe(0);
    const nodes = Array.from({ length: 100 }, (_, i) => ({ ...h.nodes[0], id: 'n' + i }));
    const links = nodes.slice(1).map(node => ({ ...h.links[0], source: 'n0', target: node.id }));
    const result = focusOffsets(nodes, links, 'n0');
    expect(result.total).toBe(99); expect(result.shown).toBe(6); expect(result.offsets.size).toBe(7);
    expect(new Set([...result.offsets.values()].map(point => point.toArray().join(','))).size).toBe(7);
    h.view.select(null); expect(h.view.mode).toBe('spatial'); h.view.dispose();
  });
  it('puts parent relationships on the left and child relationships on the right', () => {
    const h = setup(true), result = focusOffsets(h.nodes, h.links, 'b');
    expect(result.offsets.get('a')!.x).toBeLessThan(0);
    expect(result.offsets.get('c')!.x).toBeGreaterThan(0);
    expect(result.offsets.get('b')!.x).toBe(0);
    h.view.dispose();
  });
  it('reduces displayed neighbors in short split panes while retaining the full relationship count', () => {
    const h = setup(true, { width: 700, height: 440, scale: 1.25 });
    for (let i = 0; i < 10; i++) {
      const id = `extra-${i}`; h.nodes.push({ ...h.nodes[0], id });
      h.links.push({ source: 'b', target: id, data: { id, from: 'b', to: id, kind: 'hierarchy', evidence: [] } });
    }
    h.view.select('b');
    expect(h.stateChanged).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'planar', shown: 2, total: 12 }));
    h.view.dispose();
  });
});
