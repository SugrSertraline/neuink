const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A moving diagonal cylinder: only the bottom corner lifts initially. The
 * crease then straightens toward the binding and deposits a flat reverse page.
 * Coordinates use a top-left origin; the opposite direction mirrors this leaf. */
export function cornerCurlPoint(x: number, y: number, width: number, height: number, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return { x, y, z: 0 };
  if (p === 1) return { x: -x, y, z: 0 };
  const angle = .88 * (1 - smooth(.18, .88, p));
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const lift = Math.sin(Math.PI * p);
  const radius = width * Math.max(.004, (.035 + .13 * lift) * lift);
  let travel = p * (width * nx + height * ny) + Math.PI * radius / 2 * smooth(.4, .9, p);
  if (angle > .06) travel = Math.min(travel, width * nx - radius * .5);
  const distance = travel - ((width - x) * nx + (height - y) * ny);
  if (distance <= 0) return { x, y, z: 0 };
  const rotation = Math.min(Math.PI, distance / radius);
  const projection = distance <= Math.PI * radius ? radius * Math.sin(rotation) : -(distance - Math.PI * radius);
  const displacement = distance - projection;
  return { x: x - nx * displacement, y: y - ny * displacement, z: radius * (1 - Math.cos(rotation)) };
}
