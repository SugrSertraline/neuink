/** Center the visible open volume, including the cover's perspective projection. */
export function openingBookOffset(width: number, degrees: number, perspective = 1600) {
  const angle = degrees * Math.PI / 180;
  const projection = perspective / (perspective - width * Math.sin(angle));
  const hingeFromCenter = width * (1 + projection * Math.cos(angle)) / (1 + projection);
  return Math.max(0, width / 2 - hingeFromCenter);
}
