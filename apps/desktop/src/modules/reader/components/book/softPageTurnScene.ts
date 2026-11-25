import { BackSide, CanvasTexture, DirectionalLight, FrontSide, HemisphereLight, Mesh,
  MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { cornerCurlPoint } from './cornerCurlGeometry';

export type SoftPageOptions = { width: number; height: number; direction: 1 | -1;
  front: HTMLCanvasElement; back: HTMLCanvasElement | null };

/** One continuous double-sided, deforming sheet. The caller owns time and cancellation. */
export function createSoftPageTurn(host: HTMLElement, options: SoftPageOptions) {
  const { width, height, direction, front, back } = options;
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  const scene = new Scene();
  const padding = width * .2;
  const camera = new OrthographicCamera(-width, width * 2, height / 2 + padding, -height / 2 - padding, .1, width * 8);
  camera.position.z = width * 4;
  const geometry = new PlaneGeometry(width, height, 64, 48);
  const reverseGeometry = geometry.clone();
  const textures: CanvasTexture[] = [];
  const texture = (canvas: HTMLCanvasElement) => {
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; textures.push(map); return map;
  };
  const frontMaterial = new MeshStandardMaterial({ map: texture(front), roughness: .95, side: FrontSide });
  const backMaterial = new MeshStandardMaterial({ map: back ? texture(back) : null, color: 0xffffff, roughness: .95, side: BackSide });
  const frontMesh = new Mesh(geometry, frontMaterial), backMesh = new Mesh(reverseGeometry, backMaterial);
  scene.add(frontMesh, backMesh, new HemisphereLight(0xffffff, 0xbbb5aa, 2.4));
  const light = new DirectionalLight(0xfff9ee, 1.3); light.position.set(-width, height, width * 2); scene.add(light);
  const uv = reverseGeometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.domElement.remove(); geometry.dispose(); reverseGeometry.dispose();
    frontMaterial.dispose(); backMaterial.dispose(); textures.forEach(t => t.dispose());
    renderer.dispose(); renderer.forceContextLoss();
  };
  try {
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width * 3, height + padding * 2, false);
    Object.assign(renderer.domElement.style, { position: 'absolute', left: `${-width}px`, top: `${-padding}px`, width: `${width * 3}px`, height: `${height + padding * 2}px` });
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(renderer.domElement);
    const draw = (progress: number) => {
      if (disposed) return;
      if (renderer.getContext().isContextLost()) throw new Error('Page context lost');
      for (const mesh of [geometry, reverseGeometry]) {
        const positions = mesh.getAttribute('position');
        for (let row = 0; row <= 48; row++) for (let col = 0; col <= 64; col++) {
          const point = cornerCurlPoint(width * (direction === 1 ? col : 64 - col) / 64, height * row / 48, width, height, progress);
          positions.setXYZ(row * 65 + col, direction === 1 ? point.x : width - point.x,
            height / 2 - point.y, point.z);
        }
        positions.needsUpdate = true; mesh.computeVertexNormals();
      }
      frontMaterial.opacity = back ? 1 : Math.min(1, (1 - progress) / .15);
      frontMaterial.transparent = !back;
      backMaterial.opacity = frontMaterial.opacity; backMaterial.transparent = !back;
      renderer.render(scene, camera);
    };
    draw(0);
    return { draw, dispose };
  } catch (error) { dispose(); throw error; }
}
