import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { fitColumnWidth, readElementLayoutWidth, readTableViewportWidth, unfitColumnWidth } from './entryLibraryColumnSizing';

export type EntryLibraryColumnId =
  | 'title'
  | 'reading-progress'
  | 'last-read'
  | 'reading-time'
  | 'tags'
  | 'file'
  | 'parser'
  | 'updated'
  | 'actions';

type EntryLibraryColumnWidthsOptions = {
  active: boolean;
  leftPinnedColumnId: EntryLibraryColumnId | null;
  rightPinnedColumnId: EntryLibraryColumnId | null;
  visibleColumns: ReadonlySet<EntryLibraryColumnId>;
};

type ColumnWidthConfig = {
  defaultWidth: number;
  maxWidth: number;
  minWidth: number;
};

type ResizeDrag = {
  cancel: () => void;
  pointerId: number;
};

export const ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY = 'neuink.entryLibraryColumnWidths.v1';
export const ENTRY_LIBRARY_MAX_COLUMN_VIEWPORT_RATIO = 0.5;

export const ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG: Record<EntryLibraryColumnId, ColumnWidthConfig> = {
  title: { defaultWidth: 420, minWidth: 240, maxWidth: 640 },
  'reading-progress': { defaultWidth: 180, minWidth: 150, maxWidth: 480 },
  'last-read': { defaultWidth: 130, minWidth: 100, maxWidth: 320 },
  'reading-time': { defaultWidth: 120, minWidth: 96, maxWidth: 320 },
  tags: { defaultWidth: 190, minWidth: 120, maxWidth: 480 },
  file: { defaultWidth: 120, minWidth: 96, maxWidth: 360 },
  parser: { defaultWidth: 120, minWidth: 96, maxWidth: 320 },
  updated: { defaultWidth: 130, minWidth: 108, maxWidth: 320 },
  actions: { defaultWidth: 90, minWidth: 72, maxWidth: 240 }
};

export function useEntryLibraryColumnWidths({
  active,
  leftPinnedColumnId,
  rightPinnedColumnId,
  visibleColumns
}: EntryLibraryColumnWidthsOptions) {
  const [savedWidths, setSavedWidths] = useState<Partial<Record<EntryLibraryColumnId, number>>>(readSavedWidths);
  const [resizePreview, setResizePreview] = useState<{ columnId: EntryLibraryColumnId; width: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ResizeDrag | null>(null);

  const columnMaxWidth = useCallback((columnId: EntryLibraryColumnId, measuredViewportWidth = viewportWidth) =>
    resolveColumnMaxWidth(
      columnId,
      measuredViewportWidth,
      visibleColumns,
      savedWidths,
      leftPinnedColumnId,
      rightPinnedColumnId
    ),
  [leftPinnedColumnId, rightPinnedColumnId, savedWidths, viewportWidth, visibleColumns]);

  const persistWidth = useCallback((
    columnId: EntryLibraryColumnId,
    width: number | null,
    maximumWidth = columnMaxWidth(columnId)
  ) => {
    setSavedWidths((current) => {
      const next = { ...current };
      if (width === null) delete next[columnId];
      else next[columnId] = clampColumnWidth(columnId, width, maximumWidth);
      try {
        window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The resized table remains usable for this session when storage is unavailable.
      }
      return next;
    });
  }, [columnMaxWidth]);

  const cancelResize = useCallback(() => {
    dragRef.current?.cancel();
  }, []);

  useLayoutEffect(() => {
    if (!active) return undefined;
    const shell = tableShellRef.current;
    if (!shell) return undefined;

    const measure = () => {
      const nextWidth = readTableViewportWidth(shell);
      setViewportWidth((current) => current === nextWidth ? current : nextWidth);
      if (nextWidth <= 0) return;
      setSavedWidths((current) => {
        const adjusted = reconcileSavedWidths(
          current,
          nextWidth,
          visibleColumns,
          leftPinnedColumnId,
          rightPinnedColumnId
        );
        if (sameSavedWidths(current, adjusted)) return current;
        writeSavedWidths(adjusted);
        return adjusted;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(shell);
    const scroller = shell.querySelector('[data-slot="table-container"]');
    if (scroller) observer?.observe(scroller);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, leftPinnedColumnId, rightPinnedColumnId, visibleColumns]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        cancelResize();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', cancelResize);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', cancelResize);
      cancelResize();
    };
  }, [cancelResize]);

  const getBaseColumnWidth = useCallback((columnId: EntryLibraryColumnId) => {
    if (resizePreview?.columnId === columnId) return resizePreview.width;
    const saved = savedWidths[columnId];
    if (saved !== undefined) return clampColumnWidth(columnId, saved, columnMaxWidth(columnId));
    const config = ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG[columnId];
    return clampColumnWidth(columnId, config.defaultWidth, columnMaxWidth(columnId));
  }, [columnMaxWidth, resizePreview, savedWidths]);

  const baseTableWidth = [...visibleColumns].reduce((total, id) => total + getBaseColumnWidth(id), 0);
  const hasHorizontalOverflow = !viewportWidth || baseTableWidth > viewportWidth;
  const getColumnWidth = useCallback((columnId: EntryLibraryColumnId) => {
    const baseWidth = getBaseColumnWidth(columnId);
    return fitColumnWidth(baseWidth, baseTableWidth - baseWidth, viewportWidth);
  }, [baseTableWidth, getBaseColumnWidth, viewportWidth]);

  const getResizeHandleProps = useCallback((columnId: EntryLibraryColumnId, label: string) => {
    const config = ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG[columnId];
    const maximumWidth = columnMaxWidth(columnId);
    const baseWidth = getBaseColumnWidth(columnId);
    const otherWidths = baseTableWidth - baseWidth;
    const displayedWidth = getColumnWidth(columnId);

    const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const header = event.currentTarget.closest('th');
      if (!header) return;
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const headerBounds = header.getBoundingClientRect();
      const headerLayoutWidth = readElementLayoutWidth(header) || displayedWidth;
      const coordinateScale = headerLayoutWidth > 0 && headerBounds.width > 0
        ? headerBounds.width / headerLayoutWidth
        : 1;
      const currentViewportWidth = readTableViewportWidth(tableShellRef.current) || viewportWidth;
      const currentMaximumWidth = columnMaxWidth(columnId, currentViewportWidth);
      const startWidth = headerLayoutWidth;
      const startX = event.clientX;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      let currentWidth = baseWidth;
      let started = false;
      let finished = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', moveResize);
        window.removeEventListener('pointerup', finishResize);
        window.removeEventListener('pointercancel', cancelPointerResize);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        if (handle.hasPointerCapture?.(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      };
      const completeResize = (commit: boolean) => {
        if (finished) return;
        finished = true;
        dragRef.current = null;
        cleanup();
        if (commit && started) {
          persistWidth(columnId, currentWidth, currentMaximumWidth);
        }
        setResizePreview(null);
      };
      const moveResize = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        const delta = (pointerEvent.clientX - startX) / Math.max(coordinateScale, 0.01);
        if (!started && Math.abs(delta) < 4) return;
        started = true;
        currentWidth = clampColumnWidth(columnId, unfitColumnWidth(startWidth + delta, otherWidths, currentViewportWidth), currentMaximumWidth);
        setResizePreview({ columnId, width: currentWidth });
        pointerEvent.preventDefault();
      };
      const finishResize = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId === pointerId) completeResize(true);
      };
      const cancelPointerResize = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId === pointerId) completeResize(false);
      };
      dragRef.current = { cancel: () => completeResize(false), pointerId };
      handle.setPointerCapture?.(pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', moveResize);
      window.addEventListener('pointerup', finishResize);
      window.addEventListener('pointercancel', cancelPointerResize);
    };

    return {
      'aria-label': `调整“${label}”列宽`,
      'aria-orientation': 'vertical' as const,
      'aria-valuemax': Math.round(fitColumnWidth(maximumWidth, otherWidths, viewportWidth)),
      'aria-valuemin': Math.round(fitColumnWidth(config.minWidth, otherWidths, viewportWidth)),
      'aria-valuenow': Math.round(displayedWidth),
      className: 'absolute -right-1 top-0 z-30 h-full w-2 touch-none cursor-col-resize select-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-primary focus-visible:after:bg-primary',
      onDoubleClick: (event: React.MouseEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
        persistWidth(columnId, null);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        const currentViewportWidth = readTableViewportWidth(tableShellRef.current) || viewportWidth;
        const currentMaximumWidth = columnMaxWidth(columnId, currentViewportWidth);
        const header = event.currentTarget.closest('th');
        const currentWidth = readElementLayoutWidth(header) || displayedWidth;
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        persistWidth(
          columnId,
          unfitColumnWidth(currentWidth + direction * (event.shiftKey ? 24 : 8), otherWidths, currentViewportWidth),
          currentMaximumWidth
        );
      },
      onPointerDown: startResize,
      role: 'separator',
      tabIndex: 0,
      title: `拖动调整“${label}”列宽；双击恢复默认宽度`
    };
  }, [baseTableWidth, columnMaxWidth, getBaseColumnWidth, getColumnWidth, persistWidth, viewportWidth]);

  return { getColumnWidth, getResizeHandleProps, hasHorizontalOverflow, tableShellRef };
}

function readSavedWidths(): Partial<Record<EntryLibraryColumnId, number>> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG).flatMap(([columnId, config]) => {
      const value = stored[columnId];
      return typeof value === 'number' && Number.isFinite(value)
        // Keep the raw upper value until the table is measured so opening the
        // library can both clamp it to the current viewport and persist the fix.
        ? [[columnId, Math.max(config.minWidth, Math.round(value))]]
        : [];
    })) as Partial<Record<EntryLibraryColumnId, number>>;
  } catch {
    return {};
  }
}

function clampColumnWidth(columnId: EntryLibraryColumnId, width: number, maximumWidth?: number) {
  const config = ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG[columnId];
  const resolvedMaximum = Math.max(
    config.minWidth,
    Math.min(config.maxWidth, maximumWidth ?? config.maxWidth)
  );
  return Math.max(config.minWidth, Math.min(resolvedMaximum, Math.round(width)));
}

function resolveColumnMaxWidth(
  columnId: EntryLibraryColumnId,
  viewportWidth: number | null,
  visibleColumns: ReadonlySet<EntryLibraryColumnId>,
  savedWidths: Partial<Record<EntryLibraryColumnId, number>>,
  leftPinnedColumnId: EntryLibraryColumnId | null,
  rightPinnedColumnId: EntryLibraryColumnId | null
) {
  const config = ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG[columnId];
  if (!viewportWidth || viewportWidth <= 0) return config.maxWidth;

  let reservedWidth = 0;
  if (
    columnId === leftPinnedColumnId &&
    rightPinnedColumnId &&
    rightPinnedColumnId !== leftPinnedColumnId &&
    visibleColumns.has(rightPinnedColumnId)
  ) {
    const rightConfig = ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG[rightPinnedColumnId];
    reservedWidth = clampColumnWidth(
      rightPinnedColumnId,
      savedWidths[rightPinnedColumnId] ?? rightConfig.defaultWidth
    );
  } else if (
    columnId === rightPinnedColumnId &&
    leftPinnedColumnId &&
    leftPinnedColumnId !== rightPinnedColumnId &&
    visibleColumns.has(leftPinnedColumnId)
  ) {
    reservedWidth = ENTRY_LIBRARY_COLUMN_WIDTH_CONFIG[leftPinnedColumnId].minWidth;
  }
  const viewportShareLimit = Math.floor(viewportWidth * ENTRY_LIBRARY_MAX_COLUMN_VIEWPORT_RATIO);
  const pinnedPairLimit = Math.floor(viewportWidth - reservedWidth);
  return Math.max(
    config.minWidth,
    Math.min(config.maxWidth, viewportShareLimit, pinnedPairLimit)
  );
}

function reconcileSavedWidths(
  savedWidths: Partial<Record<EntryLibraryColumnId, number>>,
  viewportWidth: number,
  visibleColumns: ReadonlySet<EntryLibraryColumnId>,
  leftPinnedColumnId: EntryLibraryColumnId | null,
  rightPinnedColumnId: EntryLibraryColumnId | null
) {
  const adjusted = { ...savedWidths };
  for (const columnId of Object.keys(savedWidths) as EntryLibraryColumnId[]) {
    const savedWidth = savedWidths[columnId];
    if (savedWidth === undefined) continue;
    adjusted[columnId] = clampColumnWidth(
      columnId,
      savedWidth,
      resolveColumnMaxWidth(
        columnId,
        viewportWidth,
        visibleColumns,
        savedWidths,
        leftPinnedColumnId,
        rightPinnedColumnId
      )
    );
  }
  return adjusted;
}

function sameSavedWidths(
  left: Partial<Record<EntryLibraryColumnId, number>>,
  right: Partial<Record<EntryLibraryColumnId, number>>
) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const columnId = key as EntryLibraryColumnId;
    if (left[columnId] !== right[columnId]) return false;
  }
  return true;
}

function writeSavedWidths(widths: Partial<Record<EntryLibraryColumnId, number>>) {
  try {
    window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // The corrected in-memory widths still keep the current table usable.
  }
}
