import type { SpotlightRect } from './useSpotlight';

type PanelPlacement = { left: number; top: number; width: number; maxHeight: number };
type Obstacle = Pick<SpotlightRect, 'x' | 'y' | 'width' | 'height'>;
type CuePlacement = Obstacle;

const margin = 12;
const gap = 12;
const preferredWidth = 390;
const minimumSideWidth = 240;
const minimumBandHeight = 180;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(value, maximum));
}

function overlapArea(panel: PanelPlacement, height: number, obstacle: Obstacle) {
  const width = Math.max(0, Math.min(panel.left + panel.width, obstacle.x + obstacle.width) - Math.max(panel.left, obstacle.x));
  const overlapHeight = Math.max(0, Math.min(panel.top + height, obstacle.y + obstacle.height) - Math.max(panel.top, obstacle.y));
  return width * overlapHeight;
}

/** Attach a small, non-interactive label to the exact control being explained. */
export function placeGuideTargetCue(target: SpotlightRect | null, label: string): CuePlacement | null {
  if (!target) return null;
  const width = Math.min(172, Math.max(72, [...label].length * 13 + 30));
  const height = 28;
  const spaceRight = target.viewportWidth - (target.x + target.width) - 8;
  const spaceLeft = target.x - 8;
  const x = spaceRight >= width || spaceRight >= spaceLeft
    ? Math.min(target.viewportWidth - width - 8, target.x + target.width + 8)
    : Math.max(8, target.x - width - 8);
  return { x:Math.max(8, x), y:clamp(target.y + target.height / 2 - height / 2, 8, target.viewportHeight - height - 8), width, height };
}

/** Keep the tutorial in the dimmed viewport whenever there is usable room there. */
export function placeGuidePanel(
  spotlight: SpotlightRect | null,
  popups: readonly Obstacle[],
  measuredHeight: number,
  viewportWidth: number,
  viewportHeight: number
): PanelPlacement {
  const availableWidth = Math.max(0, viewportWidth - margin * 2);
  const availableHeight = Math.max(0, viewportHeight - margin * 2);
  const width = Math.min(preferredWidth, availableWidth);
  const height = Math.min(measuredHeight || 410, availableHeight);
  if (!spotlight) {
    return { left: Math.max(margin, (viewportWidth - width) / 2), top: margin, width, maxHeight: availableHeight };
  }

  const obstacles = [spotlight, ...popups];
  const candidates: Array<{ placement: PanelPlacement; horizontal: boolean }> = [];
  const leftSpace = spotlight.x - gap - margin;
  const rightStart = spotlight.x + spotlight.width + gap;
  const rightSpace = viewportWidth - margin - rightStart;
  for (const [space, left] of [[leftSpace, margin], [rightSpace, rightStart]]) {
    if (space < minimumSideWidth) continue;
    const sideWidth = Math.min(preferredWidth, space);
    for (const top of [clamp(spotlight.y, margin, viewportHeight - margin - height), margin, viewportHeight - margin - height]) {
      candidates.push({ placement: { left, top, width: sideWidth, maxHeight: availableHeight }, horizontal: true });
    }
  }

  const upperSpace = spotlight.y - gap - margin;
  const lowerStart = spotlight.y + spotlight.height + gap;
  const lowerSpace = viewportHeight - margin - lowerStart;
  for (const [space, top] of [[upperSpace, margin], [lowerSpace, lowerStart]]) {
    if (space < minimumBandHeight) continue;
    candidates.push({ placement: {
      left: clamp(spotlight.x + (spotlight.width - width) / 2, margin, viewportWidth - margin - width),
      top, width, maxHeight: space
    }, horizontal: false });
  }

  const area = (placement: PanelPlacement) => obstacles.reduce(
    (sum, obstacle) => sum + overlapArea(placement, Math.min(height, placement.maxHeight), obstacle), 0
  );
  const clear = candidates.filter(candidate => area(candidate.placement) === 0);
  if (clear.length) {
    clear.sort((a, b) => Number(b.horizontal) - Number(a.horizontal)
      || b.placement.width - a.placement.width
      || b.placement.maxHeight - a.placement.maxHeight);
    return clear[0].placement;
  }

  // A spotlight can occupy nearly the whole viewport; keep controls visible with the least obstruction.
  const fallback = [
    { left: margin, top: margin },
    { left: viewportWidth - margin - width, top: margin },
    { left: margin, top: viewportHeight - margin - height },
    { left: viewportWidth - margin - width, top: viewportHeight - margin - height }
  ].map(position => ({ ...position, width, maxHeight: availableHeight }));
  return [...candidates.map(candidate => candidate.placement), ...fallback]
    .sort((a, b) => area(a) - area(b) || b.width - a.width)[0];
}
