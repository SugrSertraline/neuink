import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { AssistantActiveSegment } from "@/shared/types/assistant";
import type { SourceSegment } from "@/shared/types/domain";

import { SEGMENT_FLASH_DURATION_MS } from "./readerConstants";
import { scrollToPage, scrollToSegment } from "./readerUtils";

type UsePdfSegmentNavigationOptions = {
  entryId: string;
  entryTitle: string;
  layoutVersion: number;
  onActiveSegmentChange?: (segment: AssistantActiveSegment | null) => void;
  pdfScrollRef: RefObject<HTMLDivElement>;
};

export function usePdfSegmentNavigation({
  entryId,
  entryTitle,
  layoutVersion,
  onActiveSegmentChange,
  pdfScrollRef,
}: UsePdfSegmentNavigationOptions) {
  const [flashSegmentUid, setFlashSegmentUid] = useState<string | null>(null);
  const [pendingScrollSegmentUid, setPendingScrollSegmentUid] = useState<
    string | null
  >(null);
  const flashFrameRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (flashFrameRef.current !== null) {
        window.cancelAnimationFrame(flashFrameRef.current);
      }
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const restartSegmentHighlight = useCallback((segmentUid: string) => {
    if (flashFrameRef.current !== null) {
      window.cancelAnimationFrame(flashFrameRef.current);
    }
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }

    setFlashSegmentUid(null);
    flashFrameRef.current = window.requestAnimationFrame(() => {
      flashFrameRef.current = null;
      setFlashSegmentUid(segmentUid);
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = null;
        setFlashSegmentUid((current) =>
          current === segmentUid ? null : current,
        );
      }, SEGMENT_FLASH_DURATION_MS);
    });
  }, []);

  const flashSegment = useCallback(
    (segment: SourceSegment) => {
      restartSegmentHighlight(segment.uid);
      onActiveSegmentChange?.({
        entryId,
        entryTitle,
        pageIdx: segment.page_idx,
        // The backend hydrates assistant context using the persisted real uid.
        segmentUid: segment.uid,
        text: segment.markdown ?? segment.text,
      });
    },
    [entryId, entryTitle, onActiveSegmentChange, restartSegmentHighlight],
  );

  const scrollToMountedOrPendingSegment = useCallback(
    (segment: SourceSegment) => {
      if (scrollToSegment(segment.uid, pdfScrollRef.current)) {
        setPendingScrollSegmentUid(null);
        restartSegmentHighlight(segment.uid);
        return;
      }

      scrollToPage(segment.page_idx, pdfScrollRef.current);
      setPendingScrollSegmentUid(segment.uid);
    },
    [pdfScrollRef, restartSegmentHighlight],
  );

  useEffect(() => {
    if (!pendingScrollSegmentUid) {
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | null = null;
    let frameId: number | null = null;

    const tryScroll = () => {
      if (cancelled) {
        return;
      }

      if (scrollToSegment(pendingScrollSegmentUid, pdfScrollRef.current)) {
        restartSegmentHighlight(pendingScrollSegmentUid);
        setPendingScrollSegmentUid(null);
        return;
      }

      attempts += 1;
      if (attempts >= 60) {
        setPendingScrollSegmentUid(null);
        return;
      }

      timeoutId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(tryScroll);
      }, 80);
    };

    frameId = window.requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [layoutVersion, pendingScrollSegmentUid, pdfScrollRef, restartSegmentHighlight]);

  return {
    flashSegment,
    flashSegmentUid,
    restartSegmentHighlight,
    scrollToMountedOrPendingSegment,
  };
}
