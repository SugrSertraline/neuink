import { useCallback, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

const NOTE_PANE_WIDTH_STORAGE_KEY = "neuink.reader.notePaneWidth";
export const NOTE_PANE_MIN_WIDTH = 240;
export const NOTE_PANE_MAX_WIDTH = 640;

export function useResizableNotePane() {
  const [width, setWidth] = useState(readStoredNotePaneWidth);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      let nextWidth = startWidth;

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        nextWidth = clampNotePaneWidth(
          startWidth - (pointerEvent.clientX - startX),
        );
        setPreviewWidth(nextWidth);
      };
      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setPreviewWidth(null);
        setWidth(nextWidth);
        storeNotePaneWidth(nextWidth);
      };

      setPreviewWidth(startWidth);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
      window.addEventListener("pointercancel", handlePointerUp, { once: true });
    },
    [width],
  );

  const resizeWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      setWidth((current) => {
        const next = clampNotePaneWidth(
          current + (event.key === "ArrowLeft" ? 16 : -16),
        );
        storeNotePaneWidth(next);
        return next;
      });
    },
    [],
  );

  return {
    previewWidth,
    resizeWithKeyboard,
    startResize,
    width,
  };
}

function clampNotePaneWidth(value: number) {
  return Math.min(
    NOTE_PANE_MAX_WIDTH,
    Math.max(NOTE_PANE_MIN_WIDTH, Math.round(value)),
  );
}

function readStoredNotePaneWidth() {
  if (typeof window === "undefined") {
    return 390;
  }
  const saved = Number(
    window.localStorage.getItem(NOTE_PANE_WIDTH_STORAGE_KEY),
  );
  return Number.isFinite(saved) ? clampNotePaneWidth(saved) : 390;
}

function storeNotePaneWidth(value: number) {
  window.localStorage.setItem(NOTE_PANE_WIDTH_STORAGE_KEY, String(value));
}
