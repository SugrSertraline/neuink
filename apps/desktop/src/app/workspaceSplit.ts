import type { WorkspaceSurface } from './workspaceSurface';

export const WORKSPACE_SPLIT_DIVIDER_WIDTH = 10;
export const WORKSPACE_SPLIT_STANDARD_MIN_WIDTH = 320;
export const WORKSPACE_SPLIT_NOTE_MIN_WIDTH = 224;
export const WORKSPACE_SPLIT_MIN_RESIZE_RANGE = 96;

export type WorkspaceSplitMinimums = {
  left: number;
  right: number;
};

export function getWorkspaceSplitMinimums(
  left: WorkspaceSurface,
  right: WorkspaceSurface
): WorkspaceSplitMinimums {
  return {
    left: getWorkspaceSurfaceMinimumWidth(left),
    right: getWorkspaceSurfaceMinimumWidth(right)
  };
}

export function getWorkspaceSplitWidthBounds(
  containerWidth: number,
  minimums: WorkspaceSplitMinimums = {
    left: WORKSPACE_SPLIT_STANDARD_MIN_WIDTH,
    right: WORKSPACE_SPLIT_STANDARD_MIN_WIDTH
  }
) {
  const availableWidth = Math.max(0, Math.round(containerWidth) - WORKSPACE_SPLIT_DIVIDER_WIDTH);
  const requestedLeft = Math.max(0, Math.round(minimums.left));
  const requestedRight = Math.max(0, Math.round(minimums.right));
  const requestedTotal = requestedLeft + requestedRight;

  if (requestedTotal <= availableWidth) {
    const availableResizeRange = availableWidth - requestedTotal;
    if (availableResizeRange >= WORKSPACE_SPLIT_MIN_RESIZE_RANGE) {
      return {
        minLeftWidth: requestedLeft,
        maxLeftWidth: availableWidth - requestedRight
      };
    }
  }

  if (requestedTotal === 0) {
    return { minLeftWidth: 0, maxLeftWidth: availableWidth };
  }

  // Target minimums are soft in a compact workspace. Contract both sides in
  // their requested proportion while reserving enough travel for the divider;
  // otherwise min and max collapse to one value and horizontal resizing stops.
  const resizeRange = Math.min(availableWidth, WORKSPACE_SPLIT_MIN_RESIZE_RANGE);
  const compactMinimumTotal = availableWidth - resizeRange;
  const minLeftWidth = Math.floor(compactMinimumTotal * (requestedLeft / requestedTotal));
  const minRightWidth = compactMinimumTotal - minLeftWidth;
  return {
    minLeftWidth,
    maxLeftWidth: availableWidth - minRightWidth
  };
}

export function clampWorkspaceSplitLeftWidth(
  value: number,
  containerWidth: number,
  minimums?: WorkspaceSplitMinimums
) {
  const { minLeftWidth, maxLeftWidth } = getWorkspaceSplitWidthBounds(containerWidth, minimums);
  return Math.min(maxLeftWidth, Math.max(minLeftWidth, Math.round(value)));
}

function getWorkspaceSurfaceMinimumWidth(surface: WorkspaceSurface) {
  return surface.kind === 'note'
    ? WORKSPACE_SPLIT_NOTE_MIN_WIDTH
    : WORKSPACE_SPLIT_STANDARD_MIN_WIDTH;
}
