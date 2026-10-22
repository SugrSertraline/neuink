import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  PDF_RAIL_WIDTH,
  PDF_SPREAD_GAP,
  PDF_VIEWPORT_PADDING,
} from "./readerConstants";
import { pdfWheelZoomDelta, type PdfWheelZoomRequest, type PdfWheelSample } from './pdfWheelZoom';

const PDF_ZOOM_STORAGE_KEY = "neuink.reader.pdfZoom";
const ZOOM_REGION_SUPPRESS_MS = 260;

type UsePdfReaderZoomOptions = {
  entryId: string;
  onInteractionStart: () => void;
  viewportWidth: number;
  pageDisplayMode: 'single' | 'dual';
};

export function usePdfReaderZoom({
  entryId,
  onInteractionStart,
  viewportWidth,
  pageDisplayMode,
}: UsePdfReaderZoomOptions) {
  const [zoom, setZoom] = useState(() => readStoredPdfZoom(entryId));
  const [zoomSuppressRegions, setZoomSuppressRegions] = useState(false);
  const suppressTimerRef = useRef<number | null>(null);
  const entryIdRef = useRef(entryId);
  const zoomRef = useRef(zoom);
  const interactionRef = useRef(onInteractionStart);
  interactionRef.current = onInteractionStart;
  const wheelFrame = useRef<number | null>(null);
  const wheelDelta = useRef(0);
  const wheelSample = useRef<PdfWheelSample | null>(null);
  const cancelWheel = useCallback(() => {
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
    wheelFrame.current = null;
    wheelDelta.current = 0;
    wheelSample.current = null;
  }, []);

  useEffect(() => {
    entryIdRef.current = entryId;
    cancelWheel();
    zoomRef.current = readStoredPdfZoom(entryId);
    setZoom(zoomRef.current);
  }, [entryId, cancelWheel]);

  useEffect(
    () => () => {
      cancelWheel();
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
    },
    [cancelWheel],
  );

  const pageWidth = useMemo(() => {
    return resolvePdfPageWidth({ pageDisplayMode, viewportWidth, zoom });
  }, [viewportWidth, zoom, pageDisplayMode]);

  const beginZoomInteraction = useCallback(() => {
    interactionRef.current();
    setZoomSuppressRegions(true);
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => {
      suppressTimerRef.current = null;
      setZoomSuppressRegions(false);
    }, ZOOM_REGION_SUPPRESS_MS);
  }, []);

  const commitZoom = useCallback((value: number) => {
    const nextZoom = clampZoom(value);
    if (nextZoom === zoomRef.current) return;
    zoomRef.current = nextZoom;
    beginZoomInteraction();
    writeStoredPdfZoom(entryIdRef.current, nextZoom);
    setZoom(nextZoom);
  }, [beginZoomInteraction]);

  const updateZoom = useCallback(
    (updater: (currentZoom: number) => number) => {
      cancelWheel();
      commitZoom(updater(zoomRef.current));
    },
    [cancelWheel, commitZoom],
  );

  const handleCtrlWheelZoom = useCallback(
    (request: PdfWheelZoomRequest) => {
      const delta = pdfWheelZoomDelta(request, wheelSample.current);
      if (!delta) return;
      if (wheelSample.current && request.timeStamp - wheelSample.current.timeStamp > 200) cancelWheel();
      wheelSample.current = { direction: Math.sign(request.deltaY), timeStamp: request.timeStamp };
      wheelDelta.current += delta;
      if (wheelFrame.current !== null) return;
      // Several wheel messages in one display frame produce one geometry update.
      wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = null;
        const requested = zoomRef.current + wheelDelta.current;
        const next = clampZoom(requested);
        wheelDelta.current = requested < PDF_MIN_ZOOM || requested > PDF_MAX_ZOOM ? 0 : requested - next;
        commitZoom(next);
      });
    },
    [cancelWheel, commitZoom],
  );

  return {
    handleCtrlWheelZoom,
    pageWidth,
    updateZoom,
    zoom,
    zoomSuppressRegions,
  };
}

export function resolvePdfPageWidth({
  pageDisplayMode,
  viewportWidth,
  zoom,
}: {
  pageDisplayMode: 'single' | 'dual';
  viewportWidth: number;
  zoom: number;
}) {
  const available = viewportWidth - PDF_RAIL_WIDTH - PDF_VIEWPORT_PADDING;
  const fittedWidth = pageDisplayMode === 'dual'
    ? (available - PDF_SPREAD_GAP) / 2
    : available;
  return Math.max(1, fittedWidth) * zoom;
}

function clampZoom(value: number) {
  return (
    Math.round(Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, value)) * 100) /
    100
  );
}

function pdfZoomStorageKey(entryId: string) {
  return `${PDF_ZOOM_STORAGE_KEY}.${entryId}`;
}

function readStoredPdfZoom(entryId: string) {
  if (typeof window === "undefined") {
    return 1;
  }
  try {
    for (const key of [pdfZoomStorageKey(entryId), PDF_ZOOM_STORAGE_KEY]) {
      const raw = window.localStorage.getItem(key);
      // Number(null) is zero: missing preferences must mean fit-to-width, not 30%.
      if (!raw?.trim()) continue;
      const saved = Number(raw);
      if (Number.isFinite(saved) && saved > 0) return clampZoom(saved);
    }
  } catch { /* Storage may be unavailable; fit-to-width remains usable. */ }
  return 1;
}

function writeStoredPdfZoom(entryId: string, zoom: number) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(pdfZoomStorageKey(entryId), String(clampZoom(zoom)));
  } catch { /* Keep the in-memory preference when storage is unavailable. */ }
}
