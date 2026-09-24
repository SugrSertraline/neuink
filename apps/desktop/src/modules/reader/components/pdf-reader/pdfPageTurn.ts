type PageTurnOptions = {
  pageIdx: number;
  direction: 1 | -1;
  underPageIdx: number;
  backPageIdx?: number;
  onComplete?: () => void;
};

// Snapshot the existing raster and annotation highlights, including preloaded
// pages whose mounted row is hidden. Never render a second PDF/text layout.
function snapshotPage(container: HTMLElement, pageIdx: number) {
  const surface = container.querySelector<HTMLElement>(`[data-pdf-page-index="${pageIdx}"] [data-pdf-page-surface]`);
  const bitmap = surface?.querySelector<HTMLCanvasElement>('canvas[data-pdf-rendered="true"]');
  if (!surface || !bitmap?.width || !bitmap.height) return null;
  const snapshot = document.createElement('canvas');
  snapshot.width = bitmap.width; snapshot.height = bitmap.height;
  const context = snapshot.getContext('2d');
  if (!context) { snapshot.width = 0; snapshot.height = 0; return null; }
  context.drawImage(bitmap, 0, 0);
  for (const element of surface.querySelectorAll<HTMLElement>('[data-pdf-text-highlight]')) {
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(parseFloat(element.style.left) / 100 * bitmap.width,
      parseFloat(element.style.top) / 100 * bitmap.height,
      parseFloat(element.style.width) / 100 * bitmap.width,
      parseFloat(element.style.height) / 100 * bitmap.height);
  }
  return snapshot;
}

// The live row stays mounted until the animation commits. A separate next-page
// snapshot sits below the turning sheet; it is never an interactive duplicate.
export function animatePdfPageTurn(container: HTMLElement, { pageIdx, direction, underPageIdx, backPageIdx, onComplete }: PageTurnOptions) {
  if (window.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)').matches) return null;
  const surface = container.querySelector<HTMLElement>(`[data-pdf-page-index="${pageIdx}"] [data-pdf-page-surface]`);
  if (!surface) return null;
  const rootRect = container.getBoundingClientRect(), rect = surface.getBoundingClientRect();
  const scale = rootRect.width / (container.offsetWidth || rootRect.width) || 1;
  const width = rect.width / scale, height = rect.height / scale;
  if (width <= 0 || height <= 0) return null;
  const allocated: HTMLCanvasElement[] = [];
  const capture = (index: number) => {
    const canvas = snapshotPage(container, index);
    if (canvas) allocated.push(canvas);
    return canvas;
  };
  const releaseBitmaps = () => { for (const canvas of allocated) { canvas.width = 0; canvas.height = 0; } };
  const frontPage = capture(pageIdx), underPage = capture(underPageIdx);
  const backPage = backPageIdx === undefined ? null : capture(backPageIdx);
  // If a neighbour isn't ready, use normal navigation/loading instead of
  // animating over a blank page or keeping an unreadable half-finished spread.
  if (!frontPage || !underPage || (backPageIdx !== undefined && !backPage)) { releaseBitmaps(); return null; }
  const aspect = frontPage.width / frontPage.height;
  if ([underPage, backPage].some(page => page && Math.abs(page.width / page.height / aspect - 1) > .03)) {
    releaseBitmaps(); return null; // Mixed page orientations must never be stretched to fit a snapshot.
  }
  const clip = document.createElement('div');
  clip.className = 'pdf-turn-viewport'; clip.setAttribute('aria-hidden', 'true');
  Object.assign(clip.style, { left: `${container.scrollLeft}px`, top: `${container.scrollTop}px`,
    width: `${container.clientWidth}px`, height: `${container.clientHeight}px` });
  const position = { left: `${(rect.left - rootRect.left) / scale}px`, top: `${(rect.top - rootRect.top) / scale}px`,
    width: `${width}px`, height: `${height}px` };
  const underlay = document.createElement('div');
  underlay.className = 'pdf-turn-underlay'; underlay.dataset.pagePreview = `${underPageIdx}`;
  Object.assign(underlay.style, position);
  const shadow = document.createElement('div');
  shadow.className = 'pdf-turn-shadow'; shadow.dataset.direction = `${direction}`;
  underlay.append(underPage, shadow);
  const layer = document.createElement('div');
  layer.className = 'pdf-turn-layer';
  Object.assign(layer.style, position, { perspective: `${Math.max(width, height) * 6}px` });
  const count = 20, stripWidth = width / count;
  const strips: HTMLElement[] = [];
  const crop = (bitmap: HTMLCanvasElement, index: number) => {
    const canvas = document.createElement('canvas');
    allocated.push(canvas);
    const sw = bitmap.width / count;
    canvas.width = Math.ceil(sw); canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, index * sw, 0, sw, bitmap.height, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
  for (let i = 0; i < count; i++) {
    const strip = document.createElement('div');
    strip.className = 'pdf-turn-strip'; strip.style.width = `${stripWidth + .6}px`;
    const front = crop(frontPage, i);
    if (!front) { releaseBitmaps(); return null; }
    const back = document.createElement('div');
    back.className = 'pdf-turn-back';
    back.style.backgroundSize = `${width}px 100%`; back.style.backgroundPosition = `${-i * stripWidth}px 0`;
    if (backPage) {
      // After rotating across the spine, the strips appear in reverse order.
      const reverse = crop(backPage, count - 1 - i);
      if (!reverse) { releaseBitmaps(); return null; }
      back.append(reverse);
    }
    strip.append(front, back); layer.append(strip); strips.push(strip);
  }
  clip.append(underlay, layer);
  const opacity = surface.style.opacity, pointerEvents = surface.style.pointerEvents;
  let frame = 0, start: number | null = null, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(frame); clip.remove();
    surface.style.opacity = opacity; surface.style.pointerEvents = pointerEvents;
    releaseBitmaps();
  };
  const drawPaper = (progress: number) => {
    const eased = progress * progress * (3 - 2 * progress);
    const lift = Math.sin(Math.PI * eased);
    let x = direction === 1 ? 0 : width, z = 0;
    for (let offset = 0; offset < count; offset++) {
      const i = direction === 1 ? offset : count - 1 - offset;
      const angle = (Math.PI * eased + lift * .46 * (offset / count)) * direction;
      const nextX = x + Math.cos(angle) * stripWidth * direction;
      const nextZ = z + Math.sin(Math.abs(angle)) * stripWidth;
      const strip = strips[i];
      strip.style.transformOrigin = direction === 1 ? 'left center' : 'right center';
      strip.style.transform = `translate3d(${direction === 1 ? x : x - stripWidth}px,0,${z}px) rotateY(${-angle * 180 / Math.PI}deg)`;
      // Shade each face, not the preserve-3d parent (which would flatten it).
      (strip.firstElementChild as HTMLElement).style.filter = `brightness(${1 - Math.sin(Math.min(Math.PI, Math.abs(angle))) * .18})`;
      (strip.lastElementChild as HTMLElement).style.filter = `brightness(${1 - lift * .16})`;
      x = nextX; z = nextZ;
    }
    const shadowWidth = 12 + lift * width * .24;
    const edge = Math.max(0, Math.min(width, x));
    shadow.style.width = `${shadowWidth}px`;
    shadow.style.left = `${direction === 1 ? edge - shadowWidth * .2 : edge - shadowWidth * .8}px`;
    shadow.style.opacity = `${lift * .85}`;
    shadow.style.filter = `blur(${1 + lift * 7}px)`;
    layer.style.opacity = backPage ? '1' : `${Math.min(1, (1 - progress) / .18)}`;
  };
  const draw = (time: number) => {
    if (disposed) return;
    start ??= time;
    const progress = Math.min(1, (time - start) / 460);
    drawPaper(progress);
    if (progress < 1) frame = requestAnimationFrame(draw);
    else if (onComplete) onComplete(); else dispose();
  };
  drawPaper(0); container.append(clip);
  surface.style.opacity = '0'; surface.style.pointerEvents = 'none';
  frame = requestAnimationFrame(draw);
  return dispose;
}
