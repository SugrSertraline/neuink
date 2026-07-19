import type { RailItemMotion } from './types';
import { clamp } from './readerUtils';

const RAIL_NORMAL_WIDTH = 15;
const RAIL_BULGE_RADIUS = 34;
const RAIL_BULGE_FALLOFF = 1.65;

export function calculateRailItemMotion({
  itemTopPercent,
  pointerY,
  railHeight,
  railWidth,
  isHeading,
  headingLevel
}: {
  itemTopPercent: number;
  pointerY: number | null;
  railHeight: number;
  railWidth: number;
  isHeading: boolean;
  headingLevel: number | null;
}): RailItemMotion {
  const idleWidth = isHeading
    ? headingWidth(headingLevel ?? 2, railWidth)
    : RAIL_NORMAL_WIDTH;
  const idleZIndex = isHeading ? 3 : 1;

  const idleMotion: RailItemMotion = {
    opacity: 0.86,
    scaleX: 1,
    scaleY: 1,
    width: idleWidth,
    translateX: 0,
    translateY: 0,
    zIndex: idleZIndex,
    shadow: 'none'
  };

  if (
    pointerY === null ||
    railHeight <= 0 ||
    railWidth <= 0
  ) {
    return idleMotion;
  }

  const itemY = (itemTopPercent / 100) * railHeight;
  const distance = Math.abs(itemY - pointerY);
  const rawParticipation = 1 - distance / RAIL_BULGE_RADIUS;
  const t = clamp(rawParticipation, 0, 1);
  const participation = Math.pow(t, RAIL_BULGE_FALLOFF);

  const scaleXBoost = isHeading ? 0.58 : 0.85;
  const scaleYBoost = isHeading ? 1.05 : 1.5;
  const opacityBoost = 0.14;

  const activeZIndex =
    20 +
    Math.round(participation * 20);

  return {
    opacity: 0.86 + opacityBoost * participation,
    scaleX: 1 + scaleXBoost * participation,
    scaleY: 1 + scaleYBoost * participation,
    width: idleWidth,
    translateX: 0,
    translateY: 0,
    zIndex: Math.round(
      idleZIndex +
        (activeZIndex - idleZIndex) * participation
    ),
    shadow:
      participation > 0.12
        ? [
            `0 ${1 + participation * 3}px ${5 + participation * 10}px rgba(15, 23, 42, ${
              0.12 + participation * 0.13
            })`,
            `0 0 0 ${0.5 + participation}px rgba(37, 99, 235, ${0.14 + participation * 0.2})`
          ].join(', ')
        : 'none'
  };
}

function headingWidth(level: number, railWidth: number) {
  const availableWidth = Math.max(20, railWidth - 10);
  return Math.max(17, availableWidth - (Math.min(4, level) - 1) * 3);
}
