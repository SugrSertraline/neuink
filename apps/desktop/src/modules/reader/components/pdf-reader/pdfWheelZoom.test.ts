import { expect, it } from 'vitest';
import { pdfWheelZoomDelta } from './pdfWheelZoom';

const request = { deltaY: -100, deltaMode: 0, timeStamp: 1000, viewportHeight: 600 };
it('scales with distance and speed, resetting acceleration after a pause or direction change', () => {
  expect(pdfWheelZoomDelta(request, null)).toBe(.05);
  expect(pdfWheelZoomDelta({ ...request, deltaY: -200 }, null)).toBe(.1);
  expect(pdfWheelZoomDelta(request, { direction: -1, timeStamp: 960 })).toBe(.125);
  expect(pdfWheelZoomDelta(request, { direction: -1, timeStamp: 700 })).toBe(.05);
  expect(pdfWheelZoomDelta(request, { direction: 1, timeStamp: 999 })).toBe(.05);
  expect(pdfWheelZoomDelta({ ...request, deltaY: -100000 }, null)).toBe(.18);
});
it('normalizes line/page wheel units and leaves fine touchpad deltas fractional', () => {
  expect(pdfWheelZoomDelta({ ...request, deltaY: -3, deltaMode: 1 }, null)).toBe(.024);
  expect(pdfWheelZoomDelta({ ...request, deltaY: -.1, deltaMode: 2 }, null)).toBe(.03);
  expect(pdfWheelZoomDelta({ ...request, deltaY: -1 }, null)).toBe(.0005);
  expect(pdfWheelZoomDelta({ ...request, deltaY: 0 }, null)).toBe(0);
  expect(pdfWheelZoomDelta({ ...request, deltaY: NaN }, null)).toBe(0);
});
