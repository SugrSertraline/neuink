import {
  BoxGeometry, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshStandardMaterial, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer,
  type Material, type Texture,
} from 'three';
import { paintBookCover, paintPageEdges, type BookContent, type BookPalette } from './bookCoverTexture';

export type BookStage = { point: (x: number, y: number) => void; rest: () => void; resize: () => void; dispose: () => void };
const MAX_STAGES = 3;
let activeStages = 0;

/** Bounded, on-demand renderer. DOM still owns selection, focus, opening and drag. */
export function createBookStage(host: HTMLElement, content: BookContent, onLost: () => void): BookStage {
  if (activeStages >= MAX_STAGES) throw new Error('Book scene capacity reached');
  const styles = getComputedStyle(host);
  const token = (name: string) => styles.getPropertyValue(name).trim();
  const palette: BookPalette = { cover: token('--book-cover'), ink: token('--book-ink'), paper: token('--atelier-book-paper'), edge: token('--atelier-brass-edge') };
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  activeStages++;
  const scene = new Scene();
  const book = new Group(); scene.add(book);
  const camera = new OrthographicCamera(-1, 1, 1.5, -1.5, .1, 30); camera.position.z = 7;
  const geometries = new Set<BoxGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  let animation = 0, disposed = false, start = 0;
  const desired = { x: .065, y: .26, lift: 0 };
  const clear = () => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(animation);
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    renderer.domElement.remove(); delete host.dataset.bookRendered;
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
    renderer.dispose(); renderer.forceContextLoss(); activeStages--;
  };
  const lost = (event: Event) => { event.preventDefault(); clear(); onLost(); };
  try {
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.className = 'book-cover-canvas';
    renderer.domElement.addEventListener('webglcontextlost', lost);
    const texture = (canvas: HTMLCanvasElement) => {
      const value = new CanvasTexture(canvas); value.colorSpace = SRGBColorSpace;
      value.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); textures.add(value); return value;
    };
    const material = (value: MeshStandardMaterial) => { materials.add(value); return value; };
    const cover = material(new MeshStandardMaterial({ color: new Color(palette.cover), roughness: .78, metalness: .03 }));
    const front = material(new MeshStandardMaterial({ map: texture(paintBookCover(content, palette)), roughness: .74, metalness: .025 }));
    const paper = material(new MeshStandardMaterial({ map: texture(paintPageEdges(palette)), roughness: .95 }));
    const brass = material(new MeshStandardMaterial({ color: new Color(palette.edge), roughness: .45, metalness: .5 }));
    const add = (w: number, h: number, d: number, surface: Material | Material[], x = 0, y = 0, z = 0) => {
      const geometry = new BoxGeometry(w, h, d); geometries.add(geometry);
      const mesh = new Mesh(geometry, surface); mesh.position.set(x, y, z); book.add(mesh); return mesh;
    };
    add(1.47, 2.18, .2, paper, .025);
    add(1.58, 2.3, .055, [cover, cover, cover, cover, front, cover], 0, 0, .128);
    add(1.58, 2.3, .055, cover, 0, 0, -.128);
    add(.09, 2.3, .3, cover, -.755);
    for (const y of [-.84, .84]) add(.096, .018, .312, brass, -.756, y);
    if (content.bookmark) add(.1, .31, .012, brass, .5, 1.05, .162);
    book.rotation.set(desired.x, desired.y, -.018);
    const key = new DirectionalLight(0xfff4dc, 2.5); key.position.set(-3, 5, 6); scene.add(key);
    const fill = new DirectionalLight(0xe0ebff, .75); fill.position.set(4, 1, 3); scene.add(fill);
    scene.add(new HemisphereLight(0xffffff, 0x877e73, 2));
    const render = () => { renderer.render(scene, camera); host.dataset.bookRendered = 'true'; };
    const tick = (time: number) => {
      animation = 0;
      if (disposed) return;
      if (!start) start = time;
      book.rotation.x += (desired.x - book.rotation.x) * .18;
      book.rotation.y += (desired.y - book.rotation.y) * .18;
      book.position.y += (desired.lift - book.position.y) * .18;
      const remaining = Math.abs(desired.x - book.rotation.x) + Math.abs(desired.y - book.rotation.y) + Math.abs(desired.lift - book.position.y);
      if (remaining < .001 || time - start > 500) { book.rotation.x = desired.x; book.rotation.y = desired.y; book.position.y = desired.lift; }
      else animation = requestAnimationFrame(tick);
      render();
    };
    const schedule = () => { start = 0; if (!animation && !disposed) animation = requestAnimationFrame(tick); };
    const resize = () => {
      if (disposed || !host.offsetWidth || !host.offsetHeight) return;
      const aspect = host.offsetWidth / host.offsetHeight;
      const halfHeight = Math.max(1.3, .96 / aspect);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
      renderer.setSize(host.offsetWidth, host.offsetHeight, false); render();
    };
    host.append(renderer.domElement); resize();
    return {
      point(x, y) { desired.x = .1 - Math.max(-1, Math.min(1, y)) * .14; desired.y = .48 + Math.max(-1, Math.min(1, x)) * .24; desired.lift = 0; schedule(); },
      rest() { desired.x = .065; desired.y = .26; desired.lift = 0; schedule(); },
      resize, dispose: clear,
    };
  } catch (error) { clear(); throw error; }
}
