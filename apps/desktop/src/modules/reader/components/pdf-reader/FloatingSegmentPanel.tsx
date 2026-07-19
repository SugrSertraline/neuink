import { RotateCcw, X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EDGE_GAP = 8;
const SNAP_DISTANCE = 20;
const DEFAULT_FRAME = { width: 460, height: 480 };
const MAX_FRAME = { width: 960, height: 900 };
const MIN_FRAME = { width: 280, height: 260 };

type Bounds = { width: number; height: number };
type Frame = { left: number; top: number; width: number; height: number };
type StoredFrame = {
  height: number;
  leftRatio: number;
  topRatio: number;
  width: number;
};

export function FloatingSegmentPanel({
  children,
  onClose,
  open,
  storageKey,
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  storageKey: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);

  const updateFrame = useCallback((next: Frame) => {
    frameRef.current = next;
    setFrame(next);
  }, []);

  const persistFrame = useCallback(
    (next: Frame) => {
      if (!bounds || typeof window === "undefined") {
        return;
      }

      const maxLeft = Math.max(0, bounds.width - next.width - EDGE_GAP * 2);
      const maxTop = Math.max(0, bounds.height - next.height - EDGE_GAP * 2);
      const stored: StoredFrame = {
        height: next.height,
        leftRatio: maxLeft === 0 ? 0 : (next.left - EDGE_GAP) / maxLeft,
        topRatio: maxTop === 0 ? 0 : (next.top - EDGE_GAP) / maxTop,
        width: next.width,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(stored));
    },
    [bounds, storageKey],
  );

  useLayoutEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) {
      return;
    }

    const syncBounds = () => {
      const nextBounds = {
        height: container.clientHeight,
        width: container.clientWidth,
      };
      setBounds(nextBounds);
      const current = frameRef.current;
      const nextFrame = current
        ? clampFrame(current, nextBounds)
        : frameFromStorage(storageKey, nextBounds);
      updateFrame(nextFrame);
    };

    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(container);
    return () => observer.disconnect();
  }, [storageKey, updateFrame]);

  const resetFrame = useCallback(() => {
    if (!bounds) {
      return;
    }
    const next = defaultFrame(bounds);
    updateFrame(next);
    persistFrame(next);
  }, [bounds, persistFrame, updateFrame]);

  const startMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !bounds || !frameRef.current) {
        return;
      }

      event.preventDefault();
      const origin = frameRef.current;
      const startX = event.clientX;
      const startY = event.clientY;
      const handleMove = (pointerEvent: PointerEvent) => {
        updateFrame(
          clampFrame(
            {
              ...origin,
              left: origin.left + pointerEvent.clientX - startX,
              top: origin.top + pointerEvent.clientY - startY,
            },
            bounds,
          ),
        );
      };
      const finish = () => {
        const next = snapFrame(frameRef.current ?? origin, bounds);
        updateFrame(next);
        persistFrame(next);
        releasePointerListeners(handleMove, finish);
      };

      capturePointer(event.currentTarget, event.pointerId);
      document.body.classList.add("is-segment-panel-interacting");
      document.body.style.cursor = "move";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [bounds, persistFrame, updateFrame],
  );

  const startResize = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      corner: "bottom-left" | "bottom-right",
    ) => {
      if (event.button !== 0 || !bounds || !frameRef.current) {
        return;
      }

      event.preventDefault();
      const origin = frameRef.current;
      const startX = event.clientX;
      const startY = event.clientY;
      const anchorX = corner === "bottom-left" ? origin.left + origin.width : origin.left;
      const anchorTop = origin.top;
      const handleMove = (pointerEvent: PointerEvent) => {
        updateFrame(
          corner === "bottom-left"
            ? resizeFrameFromBottomLeft(
                origin,
                bounds,
                anchorX,
                anchorTop,
                pointerEvent.clientX - startX,
                pointerEvent.clientY - startY,
              )
            : resizeFrameFromBottomRight(
                origin,
                bounds,
                anchorX,
                anchorTop,
                pointerEvent.clientX - startX,
                pointerEvent.clientY - startY,
              ),
        );
      };
      const finish = () => {
        const next = clampFrame(frameRef.current ?? origin, bounds);
        updateFrame(next);
        persistFrame(next);
        releasePointerListeners(handleMove, finish);
      };

      capturePointer(event.currentTarget, event.pointerId);
      document.body.classList.add("is-segment-panel-interacting");
      document.body.style.cursor = corner === "bottom-left" ? "nesw-resize" : "nwse-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [bounds, persistFrame, updateFrame],
  );

  if (!frame) {
    return <div aria-hidden="true" className="app-floating-segment-panel is-initializing" ref={panelRef} />;
  }

  return (
    <div
      aria-hidden={!open}
      aria-label="片段笔记与批注面板"
      className={cn("app-floating-segment-panel", !open && "is-hidden")}
      ref={panelRef}
      role="dialog"
      style={{
        height: frame.height,
        left: frame.left,
        top: frame.top,
        width: frame.width,
      }}
    >
      <div className="app-floating-segment-panel-controls" onPointerDown={startMove}>
        <Button
          className="app-floating-segment-panel-reset"
          size="icon-xs"
          title="重置位置和大小"
          type="button"
          variant="ghost"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={resetFrame}
        >
          <RotateCcw size={13} aria-hidden="true" />
        </Button>
        <span className="app-floating-segment-panel-drag-hint" aria-hidden="true">
          拖动此横条移动
        </span>
        <Button
          className="app-floating-segment-panel-close"
          size="icon-xs"
          title="关闭面板"
          type="button"
          variant="ghost"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className="app-floating-segment-panel-content">{children}</div>
      <span
        aria-label="调整面板大小"
        className="app-floating-segment-panel-resize-handle app-floating-segment-panel-resize-handle-left"
        title="拖动左下角调整面板大小"
        onPointerDown={(event) => startResize(event, "bottom-left")}
      >
        <span aria-hidden="true" />
      </span>
      <span
        aria-label="调整面板大小"
        className="app-floating-segment-panel-resize-handle app-floating-segment-panel-resize-handle-right"
        title="拖动右下角调整面板大小"
        onPointerDown={(event) => startResize(event, "bottom-right")}
      >
        <span aria-hidden="true" />
      </span>
    </div>
  );
}

function resizeFrameFromBottomRight(
  origin: Frame,
  bounds: Bounds,
  anchorLeft: number,
  anchorTop: number,
  deltaX: number,
  deltaY: number,
): Frame {
  const maxWidth = Math.max(1, Math.min(MAX_FRAME.width, bounds.width - anchorLeft - EDGE_GAP));
  const minWidth = Math.min(MIN_FRAME.width, maxWidth);
  const width = clamp(origin.width + deltaX, minWidth, maxWidth);
  const maxHeight = Math.max(1, Math.min(MAX_FRAME.height, bounds.height - anchorTop - EDGE_GAP));
  const minHeight = Math.min(MIN_FRAME.height, maxHeight);
  const height = clamp(origin.height + deltaY, minHeight, maxHeight);

  return {
    height,
    left: anchorLeft,
    top: anchorTop,
    width,
  };
}

function clampFrame(frame: Frame, bounds: Bounds): Frame {
  const maxWidth = Math.max(1, Math.min(MAX_FRAME.width, bounds.width - EDGE_GAP * 2));
  const maxHeight = Math.max(1, Math.min(MAX_FRAME.height, bounds.height - EDGE_GAP * 2));
  const width = clamp(frame.width, Math.min(MIN_FRAME.width, maxWidth), maxWidth);
  const height = clamp(frame.height, Math.min(MIN_FRAME.height, maxHeight), maxHeight);
  return {
    height,
    left: clamp(frame.left, EDGE_GAP, Math.max(EDGE_GAP, bounds.width - width - EDGE_GAP)),
    top: clamp(frame.top, EDGE_GAP, Math.max(EDGE_GAP, bounds.height - height - EDGE_GAP)),
    width,
  };
}

function resizeFrameFromBottomLeft(
  origin: Frame,
  bounds: Bounds,
  anchorRight: number,
  anchorTop: number,
  deltaX: number,
  deltaY: number,
): Frame {
  const maxWidth = Math.max(1, Math.min(MAX_FRAME.width, anchorRight - EDGE_GAP));
  const minWidth = Math.min(MIN_FRAME.width, maxWidth);
  const width = clamp(origin.width - deltaX, minWidth, maxWidth);
  const maxHeight = Math.max(1, Math.min(MAX_FRAME.height, bounds.height - anchorTop - EDGE_GAP));
  const minHeight = Math.min(MIN_FRAME.height, maxHeight);
  const height = clamp(origin.height + deltaY, minHeight, maxHeight);

  return {
    height,
    left: anchorRight - width,
    top: anchorTop,
    width,
  };
}

function defaultFrame(bounds: Bounds): Frame {
  const base = clampFrame({ ...DEFAULT_FRAME, left: EDGE_GAP, top: EDGE_GAP }, bounds);
  return {
    ...base,
    left: Math.max(EDGE_GAP, bounds.width - base.width - EDGE_GAP),
    top: Math.max(EDGE_GAP, bounds.height - base.height - EDGE_GAP),
  };
}

function frameFromStorage(storageKey: string, bounds: Bounds): Frame {
  if (typeof window === "undefined") {
    return defaultFrame(bounds);
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) {
      return defaultFrame(bounds);
    }
    const stored = JSON.parse(value) as Partial<StoredFrame>;
    if (
      !Number.isFinite(stored.width) ||
      !Number.isFinite(stored.height) ||
      !Number.isFinite(stored.leftRatio) ||
      !Number.isFinite(stored.topRatio)
    ) {
      return defaultFrame(bounds);
    }
    const base = clampFrame(
      { height: stored.height!, left: EDGE_GAP, top: EDGE_GAP, width: stored.width! },
      bounds,
    );
    return clampFrame(
      {
        ...base,
        left:
          EDGE_GAP +
          clamp(stored.leftRatio!, 0, 1) * Math.max(0, bounds.width - base.width - EDGE_GAP * 2),
        top:
          EDGE_GAP +
          clamp(stored.topRatio!, 0, 1) * Math.max(0, bounds.height - base.height - EDGE_GAP * 2),
      },
      bounds,
    );
  } catch {
    return defaultFrame(bounds);
  }
}

function snapFrame(frame: Frame, bounds: Bounds): Frame {
  const next = clampFrame(frame, bounds);
  const right = bounds.width - next.width - EDGE_GAP;
  const bottom = bounds.height - next.height - EDGE_GAP;
  return {
    ...next,
    left: Math.abs(next.left - EDGE_GAP) <= SNAP_DISTANCE ? EDGE_GAP : Math.abs(next.left - right) <= SNAP_DISTANCE ? right : next.left,
    top: Math.abs(next.top - EDGE_GAP) <= SNAP_DISTANCE ? EDGE_GAP : Math.abs(next.top - bottom) <= SNAP_DISTANCE ? bottom : next.top,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function capturePointer(element: HTMLElement, pointerId: number) {
  element.setPointerCapture?.(pointerId);
}

function releasePointerListeners(handleMove: (event: PointerEvent) => void, finish: () => void) {
  window.removeEventListener("pointermove", handleMove);
  window.removeEventListener("pointerup", finish);
  window.removeEventListener("pointercancel", finish);
  document.body.classList.remove("is-segment-panel-interacting");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}
