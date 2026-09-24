import { Bookmark, ListTree } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from 'react';

import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Annotation, SegmentBlockNote } from '@/shared/types/domain';

import type { PageSegments } from './types';
import { buildAdaptiveRailLayout, RAIL_FALLBACK_HEIGHT } from './railLayout';
import { SegmentRailMarker } from './SegmentRailMarker';
import { SegmentOutlinePanel } from './SegmentOutlinePanel';
import { clamp, compareDocumentSegments, normalizeBbox } from './readerUtils';
import { buildSegmentRailMarks, hasSegmentRailMark, segmentRailJumpTarget, summarizeSegmentRailMarks } from './segmentRailMarks';

export function SegmentRail({
  flashSegmentUid,
  activeSegmentUid,
  annotationsBySegmentUid,
  notesBySegmentUid,
  pages,
  selectedSegmentUid,
  onJumpToSegment
}: {
  flashSegmentUid: string | null;
  activeSegmentUid: string | null;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  pages: PageSegments[];
  selectedSegmentUid: string | null;
  onJumpToSegment: (segmentUid: string) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingPointerYRef = useRef<number | null>(null);
  const hoveredMarkerKeyRef = useRef<string | null>(null);
  const pointerInsideRailRef = useRef(false);
  const railRootRef = useRef<HTMLDivElement | null>(null);
  const outlineButtonRef = useRef<HTMLButtonElement | null>(null);
  const [railHeight, setRailHeight] = useState(RAIL_FALLBACK_HEIGHT);
  const [railWidth, setRailWidth] = useState(36);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [hoveredMarkerKey, setHoveredMarkerKey] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineFocusUid, setOutlineFocusUid] = useState<string | null>(null);
  const [markedOnly, setMarkedOnly] = useState(false);

  useEffect(() => {
    if (!outlineOpen) return undefined;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const outlinePanel = railRootRef.current?.querySelector(
        '[data-segment-outline-panel]'
      );
      if (
        outlinePanel?.contains(target) ||
        outlineButtonRef.current?.contains(target)
      ) {
        return;
      }
      setOutlineOpen(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [outlineOpen]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;

    const updateRailDimensions = () => {
      if (rail.clientHeight > 0) setRailHeight(rail.clientHeight);
      if (rail.clientWidth > 0) setRailWidth(rail.clientWidth);
    };
    updateRailDimensions();
    const observer = new ResizeObserver(updateRailDimensions);
    observer.observe(rail);

    return () => {
      observer.disconnect();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const allSegments = useMemo(
    () =>
      pages
        .flatMap((page) => page.segments)
        .filter(
          (segment) =>
            normalizeBbox(segment.bbox) &&
            segment.segment_type !== 'page_header' &&
            segment.segment_type !== 'page_footer' &&
            segment.segment_type !== 'page_number'
        )
        .sort(compareDocumentSegments),
    [pages]
  );
  const pinnedSegmentUids = useMemo(
    () =>
      new Set(
        [selectedSegmentUid, flashSegmentUid, activeSegmentUid].filter(
          (uid): uid is string => Boolean(uid)
        )
      ),
    [activeSegmentUid, flashSegmentUid, selectedSegmentUid]
  );
  const marks = useMemo(() => buildSegmentRailMarks(notesBySegmentUid, annotationsBySegmentUid), [notesBySegmentUid, annotationsBySegmentUid]);
  const markedCount = useMemo(() => summarizeSegmentRailMarks(allSegments, marks).total, [allSegments, marks]);
  const visibleSegments = useMemo(() => markedOnly ? allSegments.filter(segment => hasSegmentRailMark(segment, marks)) : allSegments, [allSegments, markedOnly, marks]);
  const layoutItems = useMemo(
    () =>
      buildAdaptiveRailLayout({
        segments: visibleSegments,
        railHeight,
        pinnedSegmentUids,
        ...marks
      }),
    [
      visibleSegments,
      marks,
      pinnedSegmentUids,
      railHeight
    ]
  );
  const updatePointerY = (nextPointerY: number | null) => {
    pendingPointerYRef.current = nextPointerY;
    if (animationFrameRef.current !== null) return;

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      setPointerY(pendingPointerYRef.current);
    });
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    pointerInsideRailRef.current = true;
    const bounds = event.currentTarget.getBoundingClientRect();
    updatePointerY(clamp(event.clientY - bounds.top, 0, bounds.height));
  };
  const handleRailClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Preview portals bubble through React, but are not clicks on the rail.
    if (!event.currentTarget.contains(event.target as Node)
      || (event.target as HTMLElement).closest('[data-rail-marker]')) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const clickY = clamp(event.clientY - bounds.top, 0, bounds.height);
    const nearest = layoutItems.reduce<(typeof layoutItems)[number] | null>(
      (best, item) => {
        if (!best) return item;
        const itemY = (item.top / 100) * bounds.height;
        const bestY = (best.top / 100) * bounds.height;
        return Math.abs(itemY - clickY) < Math.abs(bestY - clickY) ? item : best;
      },
      null
    );
    if (nearest) {
      onJumpToSegment(segmentRailJumpTarget(nearest, marks).uid);
    }
  };

  const handleMarkerHoverOpenChange = (markerKey: string, open: boolean) => {
    if (open) {
      hoveredMarkerKeyRef.current = markerKey;
      setHoveredMarkerKey(markerKey);
      return;
    }
    if (hoveredMarkerKeyRef.current === markerKey) {
      hoveredMarkerKeyRef.current = null;
      setHoveredMarkerKey(null);
      if (!pointerInsideRailRef.current) {
        updatePointerY(null);
      }
    }
  };

  const openOutlineAt = (segmentUid: string | null = null) => {
    setOutlineFocusUid(segmentUid);
    setOutlineOpen(true);
  };

  return (
    <div
      ref={railRootRef}
      className="relative flex h-full min-h-0 flex-col gap-2 overflow-visible border-r bg-card px-1.5 py-2"
    >
      <Button
        ref={outlineButtonRef}
        aria-label="打开详细目录"
        aria-expanded={outlineOpen}
        className="w-full shrink-0"
        size="icon-sm"
        title="详细目录"
        variant={outlineOpen ? 'secondary' : 'ghost'}
        onClick={() => {
          if (outlineOpen) setOutlineOpen(false);
          else openOutlineAt();
        }}
      >
        <ListTree size={15} />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle size="sm" className="relative w-full shrink-0 px-0" aria-label={`只看标记（${markedCount} 处）`}
            pressed={markedOnly} disabled={!markedCount && !markedOnly} onPressedChange={setMarkedOnly}>
            <Bookmark aria-hidden="true" />
            {markedCount > 0 ? <span aria-hidden="true" className="absolute -right-0.5 -top-1 rounded-sm bg-card px-0.5 text-[10px] font-semibold leading-3 text-foreground ring-1 ring-border">{markedCount > 99 ? '99+' : markedCount}</span> : null}
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="right">{markedOnly ? '显示全部片段' : `只看收藏、笔记和批注 · ${markedCount} 处`}</TooltipContent>
      </Tooltip>
      <div
        ref={railRef}
        aria-label={markedOnly ? '有标记的阅读位置' : '全文阅读导航'}
        className="relative min-h-0 w-full flex-1 overflow-visible rounded-md bg-muted/55"
        onClick={handleRailClick}
        onPointerLeave={() => {
          pointerInsideRailRef.current = false;
          if (!hoveredMarkerKey) {
            updatePointerY(null);
          }
        }}
        onPointerMove={handlePointerMove}
      >
        {layoutItems.map((item) => {
          const markerKey = `${item.segments[0].uid}:${item.segments[item.segments.length - 1].uid}`;
          return <SegmentRailMarker
            activeSegmentUid={activeSegmentUid}
            {...marks}
            flashSegmentUid={flashSegmentUid}
            item={item}
            key={markerKey}
            pointerY={pointerY}
            railHeight={railHeight}
            railWidth={railWidth}
            selectedSegmentUid={selectedSegmentUid}
            onJumpToSegment={onJumpToSegment}
            onOpenOutline={() => openOutlineAt(item.segment.uid)}
            onHoverOpenChange={(open) => handleMarkerHoverOpenChange(markerKey, open)}
            onPointerFocus={updatePointerY}
          />;
        })}
        {markedOnly && !markedCount ? <p role="status" className="px-0.5 py-3 text-center text-[10px] leading-4 text-muted-foreground">暂无标记</p> : null}
      </div>
      <SegmentOutlinePanel
        activeSegmentUid={activeSegmentUid}
        focusSegmentUid={outlineFocusUid}
        open={outlineOpen}
        segments={allSegments}
        onClose={() => setOutlineOpen(false)}
        onJumpToSegment={onJumpToSegment}
      />
    </div>
  );
}
