/** Geometry-only displacement: no screenshots, text rasterization or content copying.
 * References: shuding/liquid-glass (SDF maps), rdev/liquid-glass-react (separate optical/content layers).
 * Our edge-normal profile leaves the centre neutral and uses a bounded raster at any UI size.
 */
export function createGlassMap(width: number, height: number, radius: number) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const ratio = Math.min(1, 384 / Math.max(w, h));
  const columns = Math.max(1, Math.round(w * ratio));
  const rows = Math.max(1, Math.round(h * ratio));
  const pixels = new Uint8ClampedArray(columns * rows * 4);
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const edge = Math.min(12, Math.max(3, Math.min(w, h) * 0.22));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const px = (x + 0.5) * w / columns - w / 2;
      const py = (y + 0.5) * h / rows - h / 2;
      const qx = Math.abs(px) - w / 2 + r, qy = Math.abs(py) - h / 2 + r;
      const cx = Math.max(qx, 0), cy = Math.max(qy, 0), length = Math.hypot(cx, cy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - r;
      const bend = distance < 0 && distance > -edge ? Math.sin(-distance / edge * Math.PI) : 0;
      const nx = length > 0 ? cx / length : qx > qy ? 1 : 0;
      const ny = length > 0 ? cy / length : qx > qy ? 0 : 1;
      const index = (y * columns + x) * 4;
      pixels[index] = Math.round(128 + Math.sign(px) * nx * bend * 120);
      pixels[index + 1] = Math.round(128 + Math.sign(py) * ny * bend * 120);
      pixels[index + 2] = 128;
      pixels[index + 3] = 255;
    }
  }
  return { width: columns, height: rows, pixels };
}

const NS = 'http://www.w3.org/2000/svg';
let nextFilter = 0;

/** One bounded filter registry per active glass theme. Only portals and the hovered control need lenses. */
export function createGlassOptics() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('data-glass-optics', '');
  svg.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden';
  const defs = document.createElementNS(NS, 'defs');
  svg.append(defs); document.body.append(svg);
  const cache = new Map<string, string>();
  const lenses = new Map<HTMLElement, { filter: SVGFilterElement; image: SVGFEImageElement; key: string }>();
  function update(element: HTMLElement) {
    const lens = lenses.get(element);
    if (!lens) return;
    const w = element.offsetWidth, h = element.offsetHeight;
    if (!w || !h) return;
    const radius = Math.round(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0);
    const key = `${w}:${h}:${radius}`;
    if (lens.key === key) return;
    let url = cache.get(key);
    if (!url) {
      const map = createGlassMap(w, h, radius);
      const canvas = document.createElement('canvas');
      canvas.width = map.width; canvas.height = map.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      const image = context.createImageData(map.width, map.height);
      image.data.set(map.pixels); context.putImageData(image, 0, 0);
      url = canvas.toDataURL();
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, url);
    }
    lens.key = key;
    lens.filter.setAttribute('width', String(w)); lens.filter.setAttribute('height', String(h));
    lens.image.setAttribute('width', String(w)); lens.image.setAttribute('height', String(h));
    lens.image.setAttribute('href', url);
    element.style.setProperty('--glass-lens', `url(#${lens.filter.id})`);
  }
  const resize = new ResizeObserver(entries => entries.forEach(entry => update(entry.target as HTMLElement)));
  return {
    add(element: HTMLElement) {
      if (lenses.has(element) || lenses.size >= 12) return;
      const filter = document.createElementNS(NS, 'filter');
      filter.id = `neuink-glass-${++nextFilter}`;
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
      const image = document.createElementNS(NS, 'feImage');
      image.setAttribute('result', 'edge-map'); image.setAttribute('preserveAspectRatio', 'none');
      const displacement = document.createElementNS(NS, 'feDisplacementMap');
      displacement.setAttribute('in', 'SourceGraphic'); displacement.setAttribute('in2', 'edge-map');
      displacement.setAttribute('scale', '-16');
      displacement.setAttribute('xChannelSelector', 'R'); displacement.setAttribute('yChannelSelector', 'G');
      filter.append(image, displacement); defs.append(filter);
      lenses.set(element, { filter, image, key: '' }); resize.observe(element); update(element);
    },
    remove(element: HTMLElement) {
      resize.unobserve(element); lenses.get(element)?.filter.remove(); lenses.delete(element);
      element.style.removeProperty('--glass-lens');
    },
    dispose() {
      resize.disconnect(); lenses.forEach((_, element) => element.style.removeProperty('--glass-lens'));
      lenses.clear(); cache.clear(); svg.remove();
    }
  };
}
