import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, HemisphereLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshPhongMaterial, MOUSE, OctahedronGeometry, RingGeometry, SphereGeometry, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { sceneData, type SceneNode, type SceneLink, type NodeProjection } from './relationSceneData';
import type { RelationGraph } from './relationGraph';
import { createRelationPresentation, type RelationViewState } from './relationPresentation';

export type RelationScene = {
  update: (graph: RelationGraph) => void; highlight: (selected: string | null, hovered: string | null) => void;
  fit: () => void; zoom: (factor: number) => void; rotate: (horizontal: number, vertical: number) => void;
  resize: () => void; setActive: (active: boolean) => void; refreshColors: () => void; dispose: () => void;
};
type Callbacks = { project: (points: NodeProjection[]) => void; hover: (id: string | null) => void; select: (id: string | null) => void; lost: () => void; view?: (state: RelationViewState) => void };

/** All WebGL/camera state stays in this adapter. Rendering sleeps when the scene is idle. */
export function createRelationScene(host: HTMLElement, viewport: HTMLElement, callbacks: Callbacks): RelationScene {
  const graph = new ForceGraph3D(host, { controlType: 'orbit', rendererConfig: { alpha: true, antialias: true, powerPreference: 'low-power' } }) as unknown as ForceGraph3DInstance<SceneNode, SceneLink>;
  const renderer = graph.renderer(), controls = graph.controls() as OrbitControls, camera = graph.camera() as PerspectiveCamera;
  const meshes = new Map<string, Mesh<SphereGeometry | BoxGeometry | OctahedronGeometry, MeshPhongMaterial>>();
  const lines = new Map<string, Line<BufferGeometry, LineBasicMaterial>>();
  const pickable = new Set<string>();
  const neighbors = new Set<string>();
  const ring = new Mesh(new RingGeometry(1.22, 1.34, 64), new MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  ring.visible = false; ring.raycast = () => {}; ring.renderOrder = 2;
  graph.scene().add(ring);
  let disposed = false, active = true, selected: string | null = null, hovered: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, frame = 0, wakeFrame = 0, fitFrame = 0, fitPending = true;
  let width = 1, height = 1, scale = 1, signature = '', layoutReady = false;
  const palette = { tag: '', entry: '', note: '', muted: '', line: '', accent: '', surface: '' };
  const project = () => {
    frame = 0;
    if (disposed || !active) return;
    const view = presentation.sample(); pickable.clear(); ring.visible = false;
    const transitioning = presentation.mode === 'entering' || presentation.mode === 'leaving';
    const points = graph.graphData().nodes.map(node => {
      const position = view.positions.get(node.id) ?? new Vector3(), opacity = view.opacity.get(node.id) ?? 0;
      const mesh = meshes.get(node.id);
      if (mesh) {
        mesh.position.copy(position); mesh.visible = opacity > .01;
        mesh.material.opacity = opacity * (node.data.available ? 1 : .55); mesh.material.depthWrite = mesh.material.opacity > .98;
        mesh.quaternion.copy(mesh.userData.baseRotation).slerp(camera.quaternion, view.flatness);
        // Hover changes only material and a non-pickable ring, never the hit geometry.
        const size = node.data.kind === 'tag' ? 1 + Math.min(node.degree, 10) * .025 : 1;
        const unitsPerPixel = 2 * camera.position.distanceTo(position) * Math.tan(camera.fov * Math.PI / 360) / height * scale;
        // Gentle zoom scaling keeps large graphs pickable and close-up nodes from filling the view.
        const radius = Math.max(node.data.kind === 'tag' ? 4 : 1.8, Math.min(12, Math.sqrt(8 * size / unitsPerPixel * 6)));
        const spatialSize = radius * unitsPerPixel / 8;
        const pixelScale = (node.id === selected ? 9 : 6) * unitsPerPixel / 8;
        const visualSize = spatialSize * (1 - view.flatness) + pixelScale * view.flatness;
        mesh.scale.set(visualSize, visualSize, visualSize * (1 - view.flatness * .94));
        if (node.id === (hovered ?? selected) && opacity > .7 && !transitioning) {
          ring.visible = true; ring.position.copy(position); ring.quaternion.copy(camera.quaternion);
          ring.scale.setScalar(8 * visualSize); ring.material.opacity = .7;
        }
      }
      if (opacity > .7 && !transitioning) pickable.add(node.id);
      const vector = position.clone().project(camera);
      return { id: node.id, x: (vector.x + 1) * width / (2 * scale), y: (1 - vector.y) * height / (2 * scale),
        visible: opacity > .7 && vector.z > -1 && vector.z < 1 && Math.abs(vector.x) < .98 && Math.abs(vector.y) < .96,
        depth: opacity };
    });
    for (const link of graph.graphData().links) {
      const line = lines.get(link.data.id), from = view.positions.get(String(endpoint(link.source))), to = view.positions.get(String(endpoint(link.target)));
      if (!line || !from || !to) continue;
      const opacity = Math.min(view.opacity.get(String(endpoint(link.source))) ?? 0, view.opacity.get(String(endpoint(link.target))) ?? 0);
      line.visible = opacity > .01; line.material.opacity = opacity * (connected(link) ? .72 : hovered || selected ? .12 : .32);
      const attribute = line.geometry.getAttribute('position'); attribute.setXYZ(0, from.x, from.y, from.z); attribute.setXYZ(1, to.x, to.y, to.z);
      attribute.needsUpdate = true; line.geometry.computeBoundingSphere();
    }
    callbacks.project(points);
    viewport.dataset.camera = [camera.position.x, camera.position.y, camera.position.z].map(v => v.toFixed(1)).join(',');
    viewport.dataset.frontNodes = String(pickable.size);
  };
  const scheduleProjection = () => { if (!frame && !disposed && active) frame = requestAnimationFrame(project); };
  const wake = () => {
    if (disposed || !active) return;
    if (!wakeFrame) wakeFrame = requestAnimationFrame(() => { wakeFrame = 0; if (active && !disposed) graph.resumeAnimation(); });
    viewport.dataset.rendering = 'active';
    clearTimeout(timer); timer = setTimeout(() => { graph.pauseAnimation(); viewport.dataset.rendering = 'idle'; scheduleProjection(); }, 180);
    scheduleProjection();
  };
  const endpoint = (node: SceneLink['source']) => typeof node === 'object' ? node.id : node;
  const connected = (link: SceneLink) => [selected, hovered].some(id => id && (endpoint(link.source) === id || endpoint(link.target) === id));
  const refreshLines = () => {
    for (const link of graph.graphData().links) lines.get(link.data.id)?.material.color.set(connected(link) ? palette.accent : palette.muted);
  };
  const refreshMeshes = () => {
    neighbors.clear();
    const focus = hovered ?? selected;
    if (focus) {
      neighbors.add(focus);
      for (const link of graph.graphData().links) {
        if (endpoint(link.source) === focus) neighbors.add(String(endpoint(link.target)));
        if (endpoint(link.target) === focus) neighbors.add(String(endpoint(link.source)));
      }
    }
    for (const node of graph.graphData().nodes) {
      const mesh = meshes.get(node.id); if (!mesh) continue;
      const emphasized = node.id === selected || node.id === hovered;
      mesh.material.color.set(node.data.available ? palette[node.data.kind] : palette.muted);
      mesh.material.color.lerp(new Color(palette.surface), focus && !neighbors.has(node.id) ? .6 : .1);
      mesh.material.emissive.copy(mesh.material.color).multiplyScalar(emphasized ? .12 : .025);
    }
    ring.material.color.set(palette.accent);
    refreshLines(); wake();
  };
  const refreshColors = () => {
    const style = getComputedStyle(viewport), token = (name: string) => style.getPropertyValue(name).trim();
    Object.assign(palette, { tag: token('--chart-1'), entry: token('--chart-3'), note: token('--warning'), muted: token('--muted-foreground'), line: token('--border'), accent: token('--primary'), surface: token('--card') });
    refreshMeshes();
  };
  const presentation = createRelationPresentation({ camera, target: controls.target, nodes: () => graph.graphData().nodes,
    links: () => graph.graphData().links, size: () => ({ width, height, scale }), changed: wake,
    stateChanged: state => {
      viewport.dataset.viewMode = state.mode;
      controls.enableRotate = state.mode === 'spatial';
      controls.mouseButtons.LEFT = state.mode === 'planar' ? MOUSE.PAN : MOUSE.ROTATE;
      controls.enabled = active && (state.mode === 'spatial' || state.mode === 'planar');
      callbacks.view?.(state);
    },
  });
  const fit = () => {
    if (disposed) return;
    const nodes = graph.graphData().nodes;
    if (!nodes.length || nodes.some(node => !Number.isFinite(node.x))) return;
    const points = nodes.map(node => new Vector3(node.x, node.y, node.z));
    const center = new Box3().setFromPoints(points).getCenter(new Vector3());
    const direction = camera.position.clone().sub(controls.target).normalize();
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const tanY = Math.tan(camera.fov * Math.PI / 360) * Math.max(.3, (height - 130) / height);
    const tanX = Math.tan(camera.fov * Math.PI / 360) * camera.aspect * Math.max(.3, (width - 220) / width);
    const distance = Math.max(90, ...points.map(point => { const offset = point.clone().sub(center); return offset.dot(direction) + Math.max((Math.abs(offset.dot(right)) + 10) / tanX, (Math.abs(offset.dot(up)) + 10) / tanY); }));
    camera.position.copy(center).addScaledVector(direction, distance); controls.target.copy(center); controls.update(); wake();
  };
  const resize = () => {
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height || disposed) return;
    const changedSize = width !== rect.width || height !== rect.height;
    scale = viewport.offsetWidth ? rect.width / viewport.offsetWidth : 1;
    width = rect.width; height = rect.height;
    // The library picks objects in client pixels. Cancel inherited CSS zoom locally.
    host.style.zoom = String(1 / scale); host.style.width = `${width}px`; host.style.height = `${height}px`;
    graph.width(width).height(height); if (changedSize && layoutReady) presentation.resize(); wake();
  };
  const start = () => { callbacks.hover(null); wake(); };
  const lost = (event: Event) => { event.preventDefault(); callbacks.lost(); };
  const cancelInteraction = () => {
    // OrbitControls has no public cancel method. Release captured pointers and reset its event state.
    controls.disconnect(); controls.connect(renderer.domElement); callbacks.hover(null); wake();
  };
  const scheduleFit = () => {
    if (!fitPending || !layoutReady || fitFrame || !active || disposed) return;
    fitFrame = requestAnimationFrame(() => { fitFrame = 0; if (!active || disposed) return; fitPending = false; fit(); presentation.select(selected); });
  };
  const dispose = () => {
    if (disposed) return; disposed = true;
    presentation.dispose();
    clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(wakeFrame); cancelAnimationFrame(fitFrame);
    controls.removeEventListener('start', start); controls.removeEventListener('change', wake);
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    host.removeEventListener('pointermove', wake); host.removeEventListener('pointerdown', wake); host.removeEventListener('wheel', wake);
    host.removeEventListener('pointercancel', cancelInteraction); host.removeEventListener('contextmenu', preventContext);
    graph._destructor(); meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); }); meshes.clear();
    ring.removeFromParent(); ring.geometry.dispose(); ring.material.dispose();
    lines.forEach(line => { line.geometry.dispose(); line.material.dispose(); }); lines.clear();
    renderer.forceContextLoss(); host.replaceChildren(); delete viewport.dataset.camera; delete viewport.dataset.rendering; delete viewport.dataset.viewMode; delete viewport.dataset.frontNodes;
  };
  try {
    graph.showNavInfo(false).backgroundColor('rgba(0,0,0,0)').nodeLabel(() => '').linkLabel(() => '')
      .enableNodeDrag(false).nodeOpacity(1).nodePositionUpdate(() => true).linkDirectionalArrowLength(0).linkPositionUpdate(() => true)
      .warmupTicks(90).cooldownTicks(0)
      .onEngineStop(() => { layoutReady = true; scheduleFit(); scheduleProjection(); })
      .onNodeHover(node => { if (!disposed) callbacks.hover(node && pickable.has(node.id) ? node.id : null); })
      .onNodeClick(node => { if (!disposed && pickable.has(node.id)) callbacks.select(node.id); })
      .onBackgroundClick(() => { if (!disposed && presentation.mode === 'spatial') callbacks.select(null); });
    graph.d3Force('charge')?.strength(-380);
    graph.d3Force('link')?.distance(115);
    // A gentle centering force keeps unclassified papers from pushing the whole map far away.
    let forceNodes: SceneNode[] = [];
    const gravity = Object.assign((alpha: number) => {
      for (const node of forceNodes) {
        const pull = node.degree ? .012 : .035;
        node.vx = (node.vx ?? 0) - (node.x ?? 0) * pull * alpha;
        node.vy = (node.vy ?? 0) - (node.y ?? 0) * pull * alpha;
        node.vz = (node.vz ?? 0) - (node.z ?? 0) * pull * alpha;
      }
    }, { initialize: (nodes: SceneNode[]) => { forceNodes = nodes; } });
    graph.d3Force('workspace-center', gravity);
    const keyLight = new DirectionalLight(0xffffff, 1.8); keyLight.position.set(-60, 90, 180);
    graph.lights([new HemisphereLight(0xffffff, 0x8993a4, 2.5), keyLight]);
    controls.enableDamping = false; controls.autoRotate = false; controls.rotateSpeed = .7; controls.zoomSpeed = .85;
    controls.minDistance = 30; controls.maxDistance = 12000;
    camera.position.set(240, 160, 420); controls.update();
    controls.addEventListener('start', start); controls.addEventListener('change', wake);
    renderer.domElement.setAttribute('aria-hidden', 'true'); renderer.domElement.tabIndex = -1;
    renderer.domElement.addEventListener('webglcontextlost', lost);
    host.addEventListener('pointermove', wake, { passive: true }); host.addEventListener('pointerdown', wake, { passive: true });
    host.addEventListener('wheel', wake, { passive: true }); host.addEventListener('pointercancel', cancelInteraction);
    host.addEventListener('contextmenu', preventContext);
    refreshColors(); resize();
  } catch (error) { dispose(); throw error; }
  return {
    update(data) {
      const nextSignature = JSON.stringify([data.nodes.map(node => node.id).sort(), data.edges.map(edge => edge.id).sort()]);
      if (signature === nextSignature) {
        const byId = new Map(data.nodes.map(node => [node.id, node])); graph.graphData().nodes.forEach(node => { node.data = byId.get(node.id)!; }); refreshMeshes(); return;
      }
      signature = nextSignature; fitPending = true; layoutReady = false;
      presentation.reset();
      const next = sceneData(data, graph.graphData().nodes);
      graph.graphData({ nodes: [], links: [] });
      meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); }); meshes.clear();
      lines.forEach(line => { line.geometry.dispose(); line.material.dispose(); }); lines.clear(); pickable.clear();
      graph.nodeThreeObject(node => {
        const geometry = node.data.kind === 'tag' ? new SphereGeometry(8, 20, 16) : node.data.kind === 'entry' ? new BoxGeometry(10, 13, 4) : new OctahedronGeometry(8);
        const material = new MeshPhongMaterial({ color: new Color(node.data.available ? palette[node.data.kind] : palette.muted).lerp(new Color(palette.surface), .1), shininess: 12, specular: new Color('#333333'), transparent: true, opacity: node.data.available ? 1 : .55 });
        const mesh = new Mesh(geometry, material); if (node.data.kind === 'entry') mesh.rotation.set(.12, .24, -.08);
        mesh.userData.baseRotation = mesh.quaternion.clone();
        const raycast = mesh.raycast; mesh.raycast = (ray, hits) => { if (pickable.has(node.id)) raycast.call(mesh, ray, hits); };
        material.emissive.copy(material.color).multiplyScalar(.025);
        meshes.set(node.id, mesh); return mesh;
      }).linkThreeObject(link => {
        const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
        const line = new Line(geometry, new LineBasicMaterial({ color: connected(link) ? palette.accent : palette.muted, transparent: true, opacity: .25, depthWrite: false }));
        line.raycast = () => {}; lines.set(link.data.id, line); return line;
      }).warmupTicks(next.nodes.length > 300 ? 60 : 90).graphData(next);
      wake();
    },
    highlight(nextSelected, nextHovered) { if (selected === nextSelected && hovered === nextHovered) return; selected = nextSelected; hovered = nextHovered; if (layoutReady && !fitPending) presentation.select(selected); refreshMeshes(); },
    fit: () => { if (selected) presentation.select(selected, true); else fit(); }, resize, refreshColors,
    zoom(factor) {
      if (presentation.mode === 'entering' || presentation.mode === 'leaving') return;
      const offset = camera.position.clone().sub(controls.target); offset.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor)));
      camera.position.copy(controls.target).add(offset); controls.update(); wake();
    },
    rotate(horizontal, vertical) {
      if (presentation.mode !== 'spatial') return;
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new Vector3(0, 1, 0), horizontal); offset.applyAxisAngle(new Vector3(1, 0, 0), vertical);
      camera.position.copy(controls.target).add(offset); controls.update(); wake();
    },
    setActive(value) {
      if (disposed) return;
      active = value;
      presentation.setActive(value);
      if (value) { controls.enabled = presentation.mode === 'spatial' || presentation.mode === 'planar'; resize(); scheduleFit(); wake(); }
      else { cancelInteraction(); controls.enabled = false; graph.pauseAnimation(); clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(wakeFrame); cancelAnimationFrame(fitFrame); frame = 0; wakeFrame = 0; fitFrame = 0; viewport.dataset.rendering = 'paused'; }
    },
    dispose,
  };
}
function preventContext(event: Event) { event.preventDefault(); }
