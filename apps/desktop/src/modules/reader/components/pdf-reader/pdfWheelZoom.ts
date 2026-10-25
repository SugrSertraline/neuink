export type PdfWheelZoomRequest = {
  deltaY: number;
  deltaMode: number;
  timeStamp: number;
  viewportHeight: number;
};

export type PdfWheelSample = { direction: number; timeStamp: number };

/** One ordinary notch is ~5%; fast notches accelerate, fine trackpad deltas accumulate. */
export function pdfWheelZoomDelta(request: PdfWheelZoomRequest, previous: PdfWheelSample | null) {
  const { deltaY, deltaMode, timeStamp, viewportHeight } = request;
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1);
  const interval = previous && previous.direction === Math.sign(deltaY) ? Math.max(0, timeStamp - previous.timeStamp) : 200;
  const acceleration = 1 + Math.min(2, Math.max(0, (160 - interval) / 80));
  return -Math.sign(deltaY) * Math.min(0.18, Math.abs(pixels) * 0.0005 * acceleration);
}
