// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { createRelationScene } from './relationScene';
import type { SceneData, SceneNode } from './relationSceneData';
import type { RelationGraph } from './relationGraph';

const engine = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('3d-force-graph', () => ({ default: function (...args: unknown[]) { return engine.create(...args); } }));

function harness() {
  let data: SceneData = { nodes: [], links: [] };
  const camera = new PerspectiveCamera(50, 2, .1, 20000);
  const controls = { target: new Vector3(), enabled: true, minDistance: 0, maxDistance: 12000, mouseButtons: { LEFT: 0 },
    update: vi.fn(() => { camera.lookAt(controls.target); camera.updateMatrixWorld(); }),
    connect: vi.fn(), disconnect: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const renderer = { domElement: document.createElement('canvas'), forceContextLoss: vi.fn() };
  const callbacks = new Map<string, (...args: any[]) => void>();
  const world = new Scene(), meshes = new Map<string, Mesh>();
  let makeNode: ((node: SceneNode) => Mesh) | undefined;
  const api: Record<string, any> = { renderer: () => renderer, controls: () => controls, camera: () => camera,
    scene: () => world, nodeThreeObject: (factory: typeof makeNode) => { makeNode = factory; return proxy; },
    pauseAnimation: vi.fn(), resumeAnimation: vi.fn(), _destructor: vi.fn(),
    d3Force: () => ({ strength: vi.fn(), distance: vi.fn() }) };
  let proxy: Record<string, any>;
  api.graphData = (next?: SceneData) => {
    if (!next) return data;
    data = next; meshes.clear(); data.nodes.forEach(node => { if (makeNode) meshes.set(node.id, makeNode(node)); }); return proxy;
  };
  proxy = new Proxy(api, { get(target, key: string) {
    if (key in target) return target[key];
    return (...args: any[]) => { if (key.startsWith('on')) callbacks.set(key, args[0]); return proxy; };
  } });
  const host = document.createElement('div'), viewport = document.createElement('div');
  viewport.append(host); document.body.append(viewport); host.append(renderer.domElement);
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 500 } as DOMRect);
  Object.defineProperty(viewport, 'offsetWidth', { value: 800 });
  const events = { project: vi.fn(), hover: vi.fn(), select: vi.fn(), lost: vi.fn() };
  engine.create.mockReturnValue(proxy);
  const scene = createRelationScene(host, viewport, events);
  return { scene, host, viewport, camera, controls, renderer, callbacks, events, api, meshes, world, data: () => data };
}
const graph: RelationGraph = {
  nodes: ['a', 'b'].map(id => ({ id, kind: 'tag', title: id, subtitle: '', available: true })), edges: [],
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#466b99' }));
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('3D graph lifecycle', () => {
  it('keeps hover geometry stable, rear nodes translucent and unpickable, and preserves flat nodes on hover', () => {
    const h = harness(); h.scene.update(graph);
    h.data().nodes.forEach((node, i) => Object.assign(node, { x: 0, y: 0, z: i ? 100 : -100 }));
    h.callbacks.get('onEngineStop')!(); vi.advanceTimersByTime(250);
    const front = h.meshes.get('b')!, rear = h.meshes.get('a')!, initial = front.scale.clone();
    expect((rear.material as any).opacity).toBe(.24); expect(rear.visible).toBe(true);
    const hit = new Raycaster(new Vector3(0, 0, 500), new Vector3(0, 0, -1));
    rear.updateMatrixWorld(); const hits: any[] = []; rear.raycast(hit, hits); expect(hits).toHaveLength(0);
    for (let i = 0; i < 4; i++) {
      h.scene.highlight(null, 'b'); expect(front.scale.equals(initial)).toBe(true);
      vi.advanceTimersByTime(32); expect(front.scale.equals(initial)).toBe(true);
      h.scene.highlight(null, null); vi.advanceTimersByTime(32); expect(front.scale.equals(initial)).toBe(true);
    }
    h.scene.highlight('b', null); vi.advanceTimersByTime(800);
    const flat = front.scale.clone(); expect(flat.z).toBeLessThan(flat.x * .1);
    h.scene.highlight('b', 'b'); expect(front.scale.equals(flat)).toBe(true);
    vi.advanceTimersByTime(32); expect(front.scale.equals(flat)).toBe(true);
    const ring = h.world.children[0] as Mesh; const ringHits: any[] = []; ring.raycast(hit, ringHits);
    expect(ringHits).toHaveLength(0); expect(ring.visible).toBe(true);
    h.scene.dispose(); expect(h.world.children).toHaveLength(0);
  });
  it('waits for settled positions, cancels an in-flight fit when hidden and resumes only on return', () => {
    const h = harness(); h.scene.update(graph); h.scene.setActive(true);
    const initial = h.camera.position.clone();
    vi.advanceTimersByTime(32); expect(h.camera.position.equals(initial)).toBe(true);
    h.data().nodes.forEach((node, i) => Object.assign(node, { x: i * 160, y: i * 40, z: i * 30 }));
    h.callbacks.get('onEngineStop')!(); h.scene.setActive(false);
    vi.advanceTimersByTime(300);
    expect(h.camera.position.equals(initial)).toBe(true); expect(h.viewport.dataset.rendering).toBe('paused');
    expect(h.controls.enabled).toBe(false);
    h.scene.setActive(true); vi.advanceTimersByTime(48);
    expect(h.camera.position.equals(initial)).toBe(false); expect(h.events.project).toHaveBeenCalled();
    expect(h.host.style.zoom).toBe('0.8');
    vi.advanceTimersByTime(200); expect(h.viewport.dataset.rendering).toBe('idle');
    const settled = h.camera.position.clone(); h.scene.setActive(false); h.scene.setActive(true); vi.advanceTimersByTime(32);
    expect(h.camera.position.equals(settled)).toBe(true);
    h.scene.dispose();
  });
  it('releases timers, controls and GPU resources once, leaving no callbacks after disposal', () => {
    const h = harness(); h.scene.update(graph); h.callbacks.get('onEngineStop')!();
    h.scene.dispose(); h.scene.dispose();
    const calls = h.events.project.mock.calls.length; vi.advanceTimersByTime(1000);
    h.host.dispatchEvent(new Event('pointermove'));
    h.renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(h.events.project).toHaveBeenCalledTimes(calls); expect(h.events.lost).not.toHaveBeenCalled();
    expect(h.api._destructor).toHaveBeenCalledOnce(); expect(h.renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(h.controls.removeEventListener).toHaveBeenCalledTimes(2); expect(h.host.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0); expect(h.viewport.dataset.camera).toBeUndefined();
  });
  it('routes context loss to recovery and retains the view for metadata-only updates', () => {
    const h = harness(); h.scene.update(graph);
    h.data().nodes.forEach((node, i) => Object.assign(node, { x: i * 160, y: 0, z: 0 }));
    h.callbacks.get('onEngineStop')!(); vi.advanceTimersByTime(48);
    h.scene.rotate(.2, .1); const position = h.camera.position.clone();
    h.scene.update({ ...graph, nodes: graph.nodes.map(node => ({ ...node, title: node.title + ' updated' })) });
    h.callbacks.get('onEngineStop')!(); vi.advanceTimersByTime(32);
    expect(h.camera.position.equals(position)).toBe(true);
    expect(h.data().nodes[0].data.title).toBe('a updated');
    const event = new Event('webglcontextlost', { cancelable: true }); h.renderer.domElement.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(h.events.lost).toHaveBeenCalledOnce(); h.scene.dispose();
  });
});
