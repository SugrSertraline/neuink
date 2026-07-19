import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MIN_PAGE_WIDTH,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  PDF_RAIL_WIDTH,
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
};

export function usePdfReaderZoom({
  entryId,
  onInteractionStart,
  viewportWidth,
}: UsePdfReaderZoomOptions) {
  const [zoom, setZoom] = useState(() => readStoredPdfZoom(entryId));
  const [zoomSuppressRegions, setZoomSuppressRegions] = useState(false);
  const suppressTimerRef = useRef<number | null>(null);
  const entryIdRef = useRef(entryId);

  useEffect(() => {
    entryIdRef.current = entryId;
    setZoom(readStoredPdfZoom(entryId));
  }, [entryId]);

  useEffect(() => {
    writeStoredPdfZoom(entryIdRef.current, zoom);
  }, [zoom]);

  useEffect(
    () => () => {
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
    },
    [],
  );

  const pageWidth = useMemo(() => {
    const fitWidth = Math.max(
      MIN_PAGE_WIDTH,
      viewportWidth - PDF_RAIL_WIDTH - PDF_VIEWPORT_PADDING,
    );
    return fitWidth * zoom;
  }, [viewportWidth, zoom]);

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
  const saved = Number(window.localStorage.getItem(pdfZoomStorageKey(entryId)));
  if (Number.isFinite(saved)) {
    return clampZoom(saved);
  }
  const legacySaved = Number(window.localStorage.getItem(PDF_ZOOM_STORAGE_KEY));
  return Number.isFinite(legacySaved) ? clampZoom(legacySaved) : 1;
}

function writeStoredPdfZoom(entryId: string, zoom: number) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(pdfZoomStorageKey(entryId), String(clampZoom(zoom)));
}
