import { convertFileSrc } from "@tauri-apps/api/core";

import type { SegmentType, SourceSegment } from "@/shared/types/domain";

import type { PageSegments, SegmentRegionItem } from "./types";
import { parseListItemRegions } from "./listItemRegions";
import { revealPdfPage } from './pdfPageNavigation';

export function inferPageCount(segments: SourceSegment[]) {
  return Math.max(1, ...segments.map((segment) => segment.page_idx + 1));
}

export function groupSegmentsByPage(
  segments: SourceSegment[],
  pageCount: number,
) {
  const regionsByPage = Array.from(
    { length: pageCount },
    () => [] as SegmentRegionItem[],
  );
  const realSegmentsByPage = Array.from({ length: pageCount }, (_, pageIdx) =>
    segments
      .filter(
        (segment) =>
          segment.page_idx === pageIdx && normalizeBbox(segment.bbox),
      )
      .sort(compareSegments),
  );

  realSegmentsByPage.forEach((pageSegments) => {
    pageSegments.forEach((segment) => {
      segmentRegionsFor(segment, pageCount).forEach((region) => {
        regionsByPage[region.pageIdx]?.push(region);
      });
    });
  });

  // MinerU v2 emits captions as inline items without their own bbox, so they
  // would never hit-test. Synthesize a strip for them in the gap adjacent to
  // their visual-group anchor (below figures, above tables).
  segments
    .filter(
      (segment) =>
        !normalizeBbox(segment.bbox) &&
        (segment.block_role === "caption" || segment.block_role === "footnote") &&
        segment.visual_group_id,
    )
    .forEach((segment) => {
      const pageIdx = clamp(segment.page_idx, 0, pageCount - 1);
      const regions = regionsByPage[pageIdx];
      if (!regions) {
        return;
      }
      const stripBbox = captionStripBbox(segment, regions);
      if (!stripBbox) {
        return;
      }
      regions.push({
        bbox: stripBbox,
        hoverGroupUid: segmentHoverGroupUid(segment),
        id: segment.uid,
        isContinuation: false,
        relationGroupUid: segmentRelationGroupUid(segment),
        pageIdx,
        segment,
        sourceSegment: segment,
      });
    });

  return realSegmentsByPage.map((pageSegments, pageIdx) => ({
    pageIdx,
    regions: regionsByPage[pageIdx].sort(compareRegionItems),
    segments: pageSegments,
  }));
}

export function logicalSegmentUid(segment: SourceSegment) {
  return segment.continuation_group_id || segment.uid;
}

export function compareDocumentSegments(
  left: SourceSegment,
  right: SourceSegment,
) {
  return left.page_idx - right.page_idx || compareSegments(left, right);
}

function compareSegments(left: SourceSegment, right: SourceSegment) {
  const leftBox = normalizeBbox(left.bbox);
  const rightBox = normalizeBbox(right.bbox);

  if (leftBox && rightBox) {
    return leftBox[1] - rightBox[1] || leftBox[0] - rightBox[0];
  }

  return left.uid.localeCompare(right.uid);
}

export function normalizeBbox(bbox: SourceSegment["bbox"]) {
  if (!validBbox(bbox)) {
    return null;
  }

  const [x0, y0, x1, y1] = bbox.map((value) => clamp(value, 0, 1000)) as [
    number,
    number,
    number,
    number,
  ];

  if (x1 <= x0 || y1 <= y0) {
    return null;
  }

  return [x0, y0, x1, y1] as const;
}

function validBbox(
  bbox: SourceSegment["bbox"],
): bbox is [number, number, number, number] {
  return (
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((value) => Number.isFinite(value))
  );
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function segmentColor(type: SegmentType) {
  const colors: Record<SegmentType, string> = {
    paragraph: "#0f62fe",
    heading: "#0043ce",
    table: "#24a148",
    math: "#da1e28",
    figure: "#f1c21b",
    code: "#4d5358",
    list: "#1192e8",
    page_header: "#697386",
    page_footer: "#697386",
    page_number: "#8d99a8",
    aside_text: "#b28600",
    page_footnote: "#009d9a",
  };

  return colors[type];
}

export function segmentTypeLabel(type: SegmentType) {
  const labels: Record<SegmentType, string> = {
    paragraph: "段落",
    heading: "标题",
    table: "表格",
    math: "公式",
    figure: "图表",
    code: "代码",
    list: "列表",
    page_header: "页眉",
    page_footer: "页脚",
    page_number: "页码",
    aside_text: "侧边文字",
    page_footnote: "页面脚注",
  };

  return labels[type];
}

export function segmentDisplayLabel(segment: SourceSegment) {
  const rawType = segment.raw_type;
  const subType = segment.sub_type;
  const role = segment.block_role;

  if (rawType === "image") {
    if (subType === "seal") {
      return role === "caption"
        ? "印章题注"
        : role === "footnote"
          ? "印章脚注"
          : "印章";
    }
    return role === "caption"
      ? "图片题注"
      : role === "footnote"
        ? "图片脚注"
        : "图片";
  }

  if (rawType === "chart") {
    return role === "caption"
      ? "图表题注"
      : role === "footnote"
        ? "图表脚注"
        : "图表";
  }

  if (rawType === "table") {
    return role === "caption"
      ? "表格题注"
      : role === "footnote"
        ? "表格脚注"
        : "表格";
  }

  if (rawType === "algorithm" || subType === "algorithm") {
    return "算法";
  }

  if (rawType === "code") {
    return "代码";
  }

  if (rawType === "index") {
    return "索引";
  }

  if (rawType === "list" && subType === "ref_text") {
    return "引用";
  }

  return segmentTypeLabel(segment.segment_type);
}

// CSS scroll-padding describes the unobscured reading area, including an optional floating toolbar.
function readerViewport(container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  // Border-box dimensions keep a visible scrollbar from being mistaken for CSS zoom.
  const width = container.offsetWidth || container.clientWidth;
  const height = container.offsetHeight || container.clientHeight;
  const scaleX = width > 0 ? rect.width / width || 1 : 1;
  const scaleY = height > 0 ? rect.height / height || 1 : 1;
  const inset = Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
  return { rect, scaleX, scaleY, inset,
    anchor: (fraction: number) => inset + Math.max(0, (container.clientHeight || rect.height) - inset) * fraction };
}

export function scrollToSegment(
  segmentUid: string,
  container: HTMLElement | null,
) {
  if (!container) {
    return false;
  }

  const target = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-segment-uid], [data-source-segment-uid]',
    ),
  ).find(
    (element) =>
      element.dataset.segmentUid === segmentUid ||
      element.dataset.sourceSegmentUid === segmentUid,
  );

  if (!target) {
    return false;
  }

  const pageIdx = Number(target.closest<HTMLElement>('[data-pdf-page-index]')?.dataset.pdfPageIndex);
  if (Number.isInteger(pageIdx) && revealPdfPage(container, pageIdx, () => scrollToSegment(segmentUid, container))) return true;

  const targetRect = target.getBoundingClientRect();
  const viewport = readerViewport(container);

  container.scrollTo({
    behavior: "smooth",
    left:
      container.scrollLeft +
      (targetRect.left - viewport.rect.left) / viewport.scaleX -
      container.clientWidth / 2 +
      targetRect.width / viewport.scaleX / 2,
    top:
      container.scrollTop +
      (targetRect.top - viewport.rect.top) / viewport.scaleY -
      viewport.anchor(0.5) +
      targetRect.height / viewport.scaleY / 2,
  });
  return true;
}

function segmentRegionsFor(
  segment: SourceSegment,
  pageCount: number,
): SegmentRegionItem[] {
  const bbox = normalizeBbox(segment.bbox);
  if (!bbox) {
    return [];
  }

  const listItemRegions =
    segment.segment_type === "list"
      ? parseListItemRegions(segment.mineru_metadata?.list_item_regions)
      : [];
  const hasListItemRegions = listItemRegions.some((item) =>
    Boolean(normalizeBbox(item.bbox)),
  );
  const regions: SegmentRegionItem[] = hasListItemRegions
    ? []
    : [
        {
          bbox,
          hoverGroupUid: segmentHoverGroupUid(segment),
          id: segment.uid,
          isContinuation: false,
          relationGroupUid: segmentRelationGroupUid(segment),
          pageIdx: segment.page_idx,
          segment,
          sourceSegment: segment,
        },
      ];

  if (hasListItemRegions) {
    for (const [index, item] of listItemRegions.entries()) {
      const itemBbox = normalizeBbox(item.bbox);
      if (!itemBbox) continue;
      const itemUid = `${segment.uid}:list-item:${index}`;
      regions.push({
        bbox: itemBbox,
        hoverGroupUid: itemUid,
        id: itemUid,
        isContinuation: false,
        listItemIndex: index,
        relationGroupUid: segmentRelationGroupUid(segment),
        pageIdx: item.page_idx ?? segment.page_idx,
        segment: {
          ...segment,
          bbox: [...itemBbox],
          markdown: item.text,
          mineru_metadata: {
            ...segment.mineru_metadata,
            list_item_regions: JSON.stringify([item]),
          },
          text: item.text,
          uid: itemUid,
          page_idx: item.page_idx ?? segment.page_idx,
        },
        sourceSegment: segment,
      });
    }
  }

  // MinerU item boxes are page-local.  A parent list bbox can span pages, but
  // projecting it creates a second, inaccurate frame over the item regions.
  if (hasListItemRegions || !validBbox(segment.bbox)) {
    return regions;
  }

  const [rawX0, rawY0, rawX1, rawY1] = segment.bbox;
  const x0 = clamp(rawX0, 0, 1000);
  const x1 = clamp(rawX1, 0, 1000);

  if (rawY1 > 1000 && segment.page_idx + 1 < pageCount && x1 > x0) {
    const continuationBbox = [x0, 0, x1, clamp(rawY1 - 1000, 0, 1000)] as const;
    if (continuationBbox[3] > continuationBbox[1]) {
      regions.push({
        bbox: continuationBbox,
        hoverGroupUid: segmentHoverGroupUid(segment),
        id: `${segment.uid}-next-page`,
        isContinuation: true,
        relationGroupUid: segmentRelationGroupUid(segment),
        pageIdx: segment.page_idx + 1,
        segment,
        sourceSegment: segment,
      });
    }
  }

  if (rawY0 < 0 && segment.page_idx > 0 && x1 > x0) {
    const continuationBbox = [
      x0,
      clamp(1000 + rawY0, 0, 1000),
      x1,
      1000,
    ] as const;
    if (continuationBbox[3] > continuationBbox[1]) {
      regions.push({
        bbox: continuationBbox,
        hoverGroupUid: segmentHoverGroupUid(segment),
        id: `${segment.uid}-previous-page`,
        isContinuation: true,
        relationGroupUid: segmentRelationGroupUid(segment),
        pageIdx: segment.page_idx - 1,
        segment,
        sourceSegment: segment,
      });
    }
  }

  return regions;
}

function segmentHoverGroupUid(segment: SourceSegment) {
  return segmentRelationGroupUid(segment) ?? segment.uid;
}

function captionStripBbox(
  caption: SourceSegment,
  regions: SegmentRegionItem[],
): readonly [number, number, number, number] | null {
  const groupId = caption.visual_group_id;
  const anchorBboxes = regions
    .filter(
      (region) =>
        region.sourceSegment.visual_group_id === groupId &&
        region.sourceSegment.block_role !== "caption" &&
        region.sourceSegment.block_role !== "footnote",
    )
    .map((region) => region.bbox);
  if (anchorBboxes.length === 0) {
    return null;
  }

  const x0 = Math.min(...anchorBboxes.map((bbox) => bbox[0]));
  const x1 = Math.max(...anchorBboxes.map((bbox) => bbox[2]));
  const anchorTop = Math.min(...anchorBboxes.map((bbox) => bbox[1]));
  const anchorBottom = Math.max(...anchorBboxes.map((bbox) => bbox[3]));
  // Only regions that horizontally overlap the anchor can bound the strip;
  // columns beside the anchor must not shrink it.
  const blockers = regions.filter(
    (region) =>
      region.sourceSegment.visual_group_id !== groupId &&
      Math.min(region.bbox[2], x1) - Math.max(region.bbox[0], x0) > 10,
  );

  if (caption.raw_type === "table") {
    // Table captions conventionally sit above the table body.
    const limit = blockers
      .filter((region) => region.bbox[3] <= anchorTop + 1)
      .reduce((max, region) => Math.max(max, region.bbox[3]), 0);
    if (limit >= anchorTop - 2) {
      return null;
    }
    return [x0, limit, x1, anchorTop];
  }

  const limit = blockers
    .filter((region) => region.bbox[1] >= anchorBottom - 1)
    .reduce((min, region) => Math.min(min, region.bbox[1]), 1000);
  if (limit <= anchorBottom + 2) {
    return null;
  }
  return [x0, anchorBottom, x1, limit];
}

function segmentRelationGroupUid(segment: SourceSegment) {
  return segment.continuation_group_id ?? segment.visual_group_id ?? null;
}

function compareRegionItems(left: SegmentRegionItem, right: SegmentRegionItem) {
  return (
    left.bbox[1] - right.bbox[1] ||
    left.bbox[0] - right.bbox[0] ||
    Number(left.isContinuation) - Number(right.isContinuation)
  );
}

export function scrollToPage(pageIdx: number, container: HTMLElement | null) {
  if (!container) {
    return false;
  }

  if (revealPdfPage(container, pageIdx, () => scrollToPage(pageIdx, container))) return true;

  const target = Array.from(
    container.querySelectorAll<HTMLElement>('[data-pdf-page-index]'),
  ).find((element) => Number(element.dataset.pdfPageIndex) === pageIdx);

  if (!target) {
    return false;
  }

  const targetRect = target.getBoundingClientRect();
  const viewport = readerViewport(container);

  const targetTop = Math.max(
    0,
    container.scrollTop + (targetRect.top - viewport.rect.top) / viewport.scaleY - Math.max(12, viewport.inset),
  );
  // A page command should be deterministic in WebView2 and must not also move
  // the reader horizontally when the PDF is zoomed or displayed as a spread.
  container.scrollTo({ behavior: "auto", top: targetTop });
  return true;
}

export function scrollToPdfRect(
  pageIdx: number,
  rect: readonly [number, number, number, number] | null | undefined,
  container: HTMLElement | null,
) {
  if (!container || !rect) {
    return false;
  }

  if (revealPdfPage(container, pageIdx, () => scrollToPdfRect(pageIdx, rect, container))) return true;

  const page = Array.from(
    container.querySelectorAll<HTMLElement>('[data-pdf-page-index]'),
  ).find((element) => Number(element.dataset.pdfPageIndex) === pageIdx);
  const surface = page?.querySelector<HTMLElement>('[data-pdf-page-surface]');
  if (!surface) {
    return false;
  }

  const [x0, y0, x1, y1] = rect;
  const surfaceRect = surface.getBoundingClientRect();
  const viewport = readerViewport(container);
  const centerX = surfaceRect.left + (((x0 + x1) / 2) / 1000) * surfaceRect.width;
  const centerY = surfaceRect.top + (((y0 + y1) / 2) / 1000) * surfaceRect.height;

  container.scrollTo({
    behavior: "smooth",
    left: Math.max(
      0,
      container.scrollLeft + (centerX - viewport.rect.left) / viewport.scaleX - container.clientWidth / 2,
    ),
    top: Math.max(
      0,
      container.scrollTop + (centerY - viewport.rect.top) / viewport.scaleY - viewport.anchor(0.38),
    ),
  });
  return true;
}

export function findNearestSegmentUidInViewport(container: HTMLElement) {
  const viewport = readerViewport(container);
  const containerRect = viewport.rect;
  const targetY = containerRect.top + viewport.anchor(0.42) * viewport.scaleY;
  let nearestUid: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  const mountedRegions = Array.from(
    container.querySelectorAll<HTMLElement>("[data-segment-uid]"),
  );

  mountedRegions.forEach((element) => {
    const rect = element.getBoundingClientRect();

    if (rect.bottom < containerRect.top + viewport.inset * viewport.scaleY || rect.top > containerRect.bottom) {
      return;
    }

    const segmentCenterY = rect.top + rect.height / 2;
    const distance = Math.abs(segmentCenterY - targetY);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestUid = element.dataset.segmentUid ?? null;
    }
  });

  return nearestUid;
}

export function safeConvertFileSrc(path: string) {
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

export function hasNoteText(value: string) {
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();

  return text.length > 0;
}
