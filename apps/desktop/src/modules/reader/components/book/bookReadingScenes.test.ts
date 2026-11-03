// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BufferGeometry, Material, Texture, type Mesh, type Scene } from 'three';
import { createSoftPageTurn } from './softPageTurnScene';

const render = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
vi.mock('three', async original => ({ ...await original<typeof import('three')>(), WebGLRenderer: class {
  domElement = document.createElement('canvas');
  setPixelRatio() {} setSize() {} render = render; dispose = release; forceContextLoss() {}
  getContext() { return { isContextLost: () => false }; }
} }));
vi.mock('./bookCoverTexture', () => ({ paintBookCover: () => document.createElement('canvas'), paintPageEdges: () => document.createElement('canvas') }));
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  render.mockClear(); release.mockClear(); frames.clear(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const tick = (time: number) => { const queue = [...frames.values()]; frames.clear(); queue.forEach(cb => cb(time)); };

it.each([1, -1] as const)('renders a continuous sheet in direction %s and releases GPU resources', direction => {
  const host = document.createElement('div'); document.body.append(host);
  const geometry = vi.spyOn(BufferGeometry.prototype, 'dispose'), material = vi.spyOn(Material.prototype, 'dispose'), texture = vi.spyOn(Texture.prototype, 'dispose');
  const scene = createSoftPageTurn(host, { width: 400, height: 600, direction, front: document.createElement('canvas'), back: document.createElement('canvas') });
  scene.draw(.15);
  const model = render.mock.calls[render.mock.calls.length - 1][0] as Scene;
  const mesh = model.children[0] as Mesh;
  const vertices = mesh.geometry.getAttribute('position');
  expect(vertices.count).toBe(65 * 49);
  const hinge = direction === 1 ? 0 : 64;
  expect(vertices.getX(hinge)).toBeCloseTo(direction === 1 ? 0 : 400);
  expect(vertices.getZ(hinge)).toBe(0);
  expect(vertices.getZ(direction === 1 ? 64 : 0)).toBe(0);
  expect(vertices.getZ(48 * 65 + (direction === 1 ? 64 : 0))).toBeGreaterThan(0);
  scene.dispose(); scene.dispose();
  expect(host.children.length).toBe(0); expect(release).toHaveBeenCalledOnce();
  expect(geometry).toHaveBeenCalledTimes(2); expect(material).toHaveBeenCalledTimes(2); expect(texture).toHaveBeenCalledTimes(2);
});

