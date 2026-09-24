import type { BookStage } from './bookScene';

/** Keep the shelf's DOM cover: replacing it with a separately typeset texture causes a hover jump. */
export function createBookCoverMotion(host: HTMLElement): BookStage {
  let frame = 0, disposed = false;
  let x = 0, y = 0;
  const properties = ['--book-tilt-x', '--book-tilt-y', '--book-rim-gain', '--book-sheen', '--book-sheen-angle', '--book-shadow-x'];
  const reset = () => {
    cancelAnimationFrame(frame); frame = 0;
    properties.forEach(name => host.style.removeProperty(name));
  };
  const stage: BookStage = {
    point(nextX, nextY) {
      if (disposed) return;
      x = Math.max(-1, Math.min(1, nextX)); y = Math.max(-1, Math.min(1, nextY));
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        host.style.setProperty('--book-tilt-x', `${(6 - y * 8).toFixed(2)}deg`);
        host.style.setProperty('--book-tilt-y', `${(-22 + x * 14).toFixed(2)}deg`);
        host.style.setProperty('--book-rim-gain', `${(8 + x * 4).toFixed(2)}%`);
        host.style.setProperty('--book-sheen', (0.1 + x * 0.04).toFixed(2));
        host.style.setProperty('--book-sheen-angle', `${(115 + x * 25).toFixed(2)}deg`);
        host.style.setProperty('--book-shadow-x', `${(5 - x * 4).toFixed(2)}px`);
      });
    },
    rest: reset,
    resize() {}, // CSS owns the cover's dimensions, including UI scaling.
    dispose() { disposed = true; reset(); },
  };
  // A stationary pointer or keyboard focus must reveal depth too, not only pointer movement.
  stage.point(0, 0);
  return stage;
}
