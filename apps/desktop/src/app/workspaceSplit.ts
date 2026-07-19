export const WORKSPACE_SPLIT_DIVIDER_WIDTH = 10;
export const WORKSPACE_SPLIT_MIN_LEFT_WIDTH = 320;
export const WORKSPACE_SPLIT_MIN_RIGHT_WIDTH = 320;

export function clampWorkspaceSplitLeftWidth(value: number, containerWidth: number) {
  const maxLeftWidth = Math.max(
    WORKSPACE_SPLIT_MIN_LEFT_WIDTH,
    Math.round(containerWidth) - WORKSPACE_SPLIT_DIVIDER_WIDTH - WORKSPACE_SPLIT_MIN_RIGHT_WIDTH
  );

  return Math.min(maxLeftWidth, Math.max(WORKSPACE_SPLIT_MIN_LEFT_WIDTH, Math.round(value)));
}
