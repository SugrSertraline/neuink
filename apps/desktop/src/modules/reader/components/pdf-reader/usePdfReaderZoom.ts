import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  PDF_RAIL_WIDTH,
  PDF_SPREAD_GAP,
  PDF_VIEWPORT_PADDING,
  PDF_ZOOM_STEP,
} from "./readerConstants";

const PDF_ZOOM_STORAGE_KEY = "neuink.reader.pdfZoom";
const ZOOM_REGION_SUPPRESS_MS = 260;

type ZoomAnchor = {
  clientX: number;
  clientY: number;
  container: HTMLDivElement;
};

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

  useEffect(() => {
    entryIdRef.current = entryId;
    setZoom(readStoredPdfZoom(entryId));
  }, [entryId]);

  useEffect(
    () => () => {
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
    },
    [],
  );

  const pageWidth = useMemo(() => {
    return resolvePdfPageWidth({ pageDisplayMode, viewportWidth, zoom });
  }, [viewportWidth, zoom, pageDisplayMode]);

  const beginZoomInteraction = useCallback(() => {
    onInteractionStart();
    setZoomSuppressRegions(true);
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => {
      suppressTimerRef.current = null;
      setZoomSuppressRegions(false);
    }, ZOOM_REGION_SUPPRESS_MS);
  }, [onInteractionStart]);

  const updateZoom = useCallback(
    (updater: (currentZoom: number) => number, anchor?: ZoomAnchor) => {
      setZoom((currentZoom) => {
        const nextZoom = clampZoom(updater(currentZoom));
        if (nextZoom === currentZoom) {
          return currentZoom;
        }

        beginZoomInteraction();
        writeStoredPdfZoom(entryIdRef.current, nextZoom);
        if (anchor) {
          keepZoomAnchor(anchor, nextZoom / currentZoom);
        }
        return nextZoom;
      });
    },
    [beginZoomInteraction],
  );

  const handleCtrlWheelZoom = useCallback(
    ({
      clientX,
      clientY,
      container,
      direction,
    }: ZoomAnchor & { direction: 1 | -1 }) => {
      updateZoom((currentZoom) => currentZoom + direction * PDF_ZOOM_STEP, {
        clientX,
        clientY,
        container,
      });
    },
    [updateZoom],
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

function keepZoomAnchor(anchor: ZoomAnchor, zoomRatio: number) {
  const { clientX, clientY, container } = anchor;
  const rect = container.getBoundingClientRect();
  const viewportX = clientX - rect.left;
  const viewportY = clientY - rect.top;
  const contentX = container.scrollLeft + viewportX;
  const contentY = container.scrollTop + viewportY;

  const applyAnchoredScroll = () => {
    container.scrollLeft = contentX * zoomRatio - viewportX;
    container.scrollTop = contentY * zoomRatio - viewportY;
  };

  window.requestAnimationFrame(() => {
    applyAnchoredScroll();
    window.requestAnimationFrame(applyAnchoredScroll);
  });
  window.setTimeout(applyAnchoredScroll, 180);
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
