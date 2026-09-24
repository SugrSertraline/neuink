import { Box3, Vector3, type PerspectiveCamera } from 'three';
import type { SceneNode, SceneLink } from './relationSceneData';

export type RelationViewMode = 'spatial' | 'entering' | 'planar' | 'leaving';
export type RelationViewState = { mode: RelationViewMode; shown: number; total: number; ids?: string[] };
type CameraPose = { position: Vector3; target: Vector3; fov: number };
export type RelationFrame = { positions: Map<string, Vector3>; opacity: Map<string, number>; flatness: number };
type Tween = { started: number; duration: number; from: RelationFrame; to: RelationFrame; fromCamera: CameraPose; toCamera: CameraPose; entering: boolean };
const endpoint = (value: SceneLink['source']) => typeof value === 'object' ? value.id : value;
export const pointOf = (node: SceneNode) => new Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);

/** Depth is relative to the cloud, not the camera's near/far clipping planes. */
export function frontOpacity(positions: Map<string, Vector3>, cameraPosition: Vector3) {
  const values = [...positions.values()], center = new Vector3();
  values.forEach(point => center.add(point)); if (values.length) center.divideScalar(values.length);
  const direction = cameraPosition.clone().sub(center).normalize();
  const depths = values.map(point => point.clone().sub(center).dot(direction));
  const extent = Math.max(1, ...depths.map(Math.abs));
  const result = new Map<string, number>();
  [...positions.keys()].forEach((id, index) => {
    const t = Math.max(0, Math.min(1, (depths[index] / extent + .22) / .44));
    // Retain the rear structure without letting its labels or hit targets obscure the front.
    result.set(id, values.length <= 1 || extent <= 1 ? 1 : .24 + .76 * t * t * (3 - 2 * t));
  });
  return result;
}

/** Bound the visual fan; every relationship stays accessible in the detail list. */
export function focusOffsets(nodes: SceneNode[], links: SceneLink[], id: string, limit = 12) {
  const adjacent = new Set<string>();
  links.forEach(link => {
    if (endpoint(link.source) === id) adjacent.add(String(endpoint(link.target)));
    if (endpoint(link.target) === id) adjacent.add(String(endpoint(link.source)));
  });
  adjacent.delete(id);
  const neighbors = nodes.filter(node => adjacent.has(node.id)).sort((a, b) =>
    a.data.kind.localeCompare(b.data.kind) || a.data.title.localeCompare(b.data.title) || a.id.localeCompare(b.id));
  const shown = neighbors.slice(0, limit), offsets = new Map<string, Vector3>([[id, new Vector3()]]);
  const leftCount = shown.length > 4 ? Math.ceil(shown.length / 2) : 0;
  shown.forEach((node, index) => {
    const left = index < leftCount, count = left ? leftCount : shown.length - leftCount;
    const row = left ? index : index - leftCount;
    offsets.set(node.id, new Vector3(left ? -230 : 230, ((count - 1) / 2 - row) * 58, 0));
  });
  return { offsets, total: neighbors.length, shown: shown.length };
}

/** Owns only transient presentation state; original force-layout coordinates never change. */
export function createRelationPresentation({ camera, target, nodes, links, size, changed, stateChanged }: {
  camera: PerspectiveCamera; target: Vector3; nodes: () => SceneNode[]; links: () => SceneLink[];
  size: () => { width: number; height: number; scale: number };
  changed: () => void; stateChanged: (state: RelationViewState) => void;
}) {
  let mode: RelationViewMode = 'spatial', selected: string | null = null, saved: CameraPose | null = null;
  let tween: Tween | null = null, flat: RelationFrame | null = null, raf = 0, active = true, disposed = false, pausedAt = 0;
  let counts = { shown: 0, total: 0, ids: [] as string[] };
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const pose = (): CameraPose => ({ position: camera.position.clone(), target: target.clone(), fov: camera.fov });
  const applyCamera = (value: CameraPose) => {
    camera.position.copy(value.position); target.copy(value.target); camera.fov = value.fov;
    camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
  const spatial = (position = camera.position): RelationFrame => {
    const positions = new Map(nodes().map(node => [node.id, pointOf(node)]));
    return { positions, opacity: frontOpacity(positions, position), flatness: 0 };
  };
  const report = () => stateChanged({ mode, ...counts });
  const finish = () => {
    if (!tween) return;
    applyCamera(tween.toCamera); flat = tween.entering ? tween.to : null;
    mode = tween.entering ? 'planar' : 'spatial'; tween = null;
    if (mode === 'spatial') saved = null;
    report(); changed();
  };
  const sample = (): RelationFrame => {
    if (!tween) return flat ?? spatial();
    const now = active ? performance.now() : pausedAt;
    const progress = Math.max(0, Math.min(1, (now - tween.started) / tween.duration));
    const t = progress * progress * (3 - 2 * progress);
    applyCamera({
      position: tween.fromCamera.position.clone().lerp(tween.toCamera.position, t),
      target: tween.fromCamera.target.clone().lerp(tween.toCamera.target, t),
      fov: tween.fromCamera.fov + (tween.toCamera.fov - tween.fromCamera.fov) * t,
    });
    const positions = new Map<string, Vector3>(), opacity = new Map<string, number>();
    tween.to.positions.forEach((point, id) => {
      positions.set(id, (tween!.from.positions.get(id) ?? point).clone().lerp(point, t));
      opacity.set(id, (tween!.from.opacity.get(id) ?? 0) * (1 - t) + (tween!.to.opacity.get(id) ?? 0) * t);
    });
    return { positions, opacity, flatness: tween.from.flatness * (1 - t) + tween.to.flatness * t };
  };
  const tick = () => {
    raf = 0; if (!active || disposed || !tween) return;
    sample(); changed();
    if (performance.now() - tween.started >= tween.duration) finish();
    else raf = requestAnimationFrame(tick);
  };
  const start = (to: RelationFrame, toCamera: CameraPose, entering: boolean) => {
    const from = sample(), fromCamera = pose();
    cancelAnimationFrame(raf); raf = 0;
    mode = entering ? 'entering' : 'leaving';
    tween = { started: active ? performance.now() : pausedAt, duration: 620, from, to, fromCamera, toCamera, entering };
    report();
    if (media?.matches) finish();
    else if (active) raf = requestAnimationFrame(tick);
    changed();
  };
  const select = (id: string | null, force = false) => {
    if (disposed || (!force && id === selected)) return;
    if (id && !nodes().some(node => node.id === id)) id = null;
    selected = id;
    if (!id) {
      if (saved) start(spatial(saved.position), saved, false);
      return;
    }
    if (!saved) saved = pose();
    const origin = pointOf(nodes().find(node => node.id === id)!);
    const { width, height, scale } = size(), logicalWidth = width / scale, compact = logicalWidth < 880;
    const { offsets, total, shown } = focusOffsets(nodes(), links(), id, compact ? 6 : 12); counts = { total, shown, ids: [...offsets.keys()] };
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const direction = camera.position.clone().sub(target).normalize();
    const destination = spatial(), extent = new Box3().setFromPoints([...offsets.values()]);
    // Include label space in the planar bounds, so labels don't crowd the bubble or viewport edge.
    extent.min.x -= 24; extent.max.x += 166; extent.min.y -= 34; extent.max.y += 34;
    const center = extent.getCenter(new Vector3()), span = extent.getSize(new Vector3());
    const reserved = compact ? 0 : 340 * scale;
    const reservedBottom = compact ? Math.min(180 * scale, height * .42) : 0;
    const fov = 24, tan = Math.tan(fov * Math.PI / 360);
    const distance = Math.max(280, span.y / (2 * tan * Math.max(.2, (height - 120 * scale - reservedBottom) / height)),
      span.x / (2 * tan * camera.aspect * Math.max(.25, (width - reserved - 80 * scale) / width)));
    const cameraTarget = origin.clone().addScaledVector(right, center.x).addScaledVector(up, center.y)
      .addScaledVector(right, reserved / width * distance * tan * camera.aspect)
      .addScaledVector(up, -reservedBottom / height * distance * tan);
    destination.opacity.forEach((_, key) => destination.opacity.set(key, offsets.has(key) ? 1 : 0));
    offsets.forEach((offset, key) => destination.positions.set(key, origin.clone().addScaledVector(right, offset.x).addScaledVector(up, offset.y)));
    destination.flatness = 1;
    start(destination, { position: cameraTarget.clone().addScaledVector(direction, distance), target: cameraTarget, fov }, true);
  };
  const reduced = () => { if (media?.matches) { cancelAnimationFrame(raf); raf = 0; finish(); } };
  media?.addEventListener('change', reduced);
  return {
    sample, select,
    get mode() { return mode; },
    resize() { if (selected && mode === 'planar') select(selected, true); },
    setActive(value: boolean) {
      if (value === active || disposed) return;
      if (!value) { pausedAt = performance.now(); cancelAnimationFrame(raf); raf = 0; }
      else if (tween) { tween.started += performance.now() - pausedAt; raf = requestAnimationFrame(tick); }
      active = value;
    },
    reset() {
      cancelAnimationFrame(raf); raf = 0; tween = null; flat = null; selected = null; mode = 'spatial';
      if (saved) applyCamera(saved); saved = null; counts = { shown: 0, total: 0, ids: [] }; report();
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); media?.removeEventListener('change', reduced); },
  };
}
