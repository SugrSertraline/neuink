import { memo, useId } from 'react';

import { preservesOriginalContent } from '../../translation/translationEligibility';
import type { PageSegments, SegmentRegionItem } from './types';

type Box = SegmentRegionItem['bbox'];

export function pdfOriginalContentWindows(page: PageSegments): Box[] {
  return page.regions.flatMap((region) => {
    if (!preservesOriginalContent(region.segment.segment_type)) return [];
    const box = region.bbox;
    if (!box.every(Number.isFinite)) return [];
    const left = Math.max(0, Math.min(box[0], box[2]));
    const top = Math.max(0, Math.min(box[1], box[3]));
    const right = Math.min(1000, Math.max(box[0], box[2]));
    const bottom = Math.min(1000, Math.max(box[1], box[3]));
    return right > left && bottom > top ? [[left, top, right, bottom] as Box] : [];
  });
}

// Mask the entire raster rather than individual text boxes: parser bounds can
// miss glyph edges and whole lines. Black windows retain original visual blocks;
// an SVG mask also handles overlapping windows without painting their overlap.
export const PdfTranslationPageMask = memo(function PdfTranslationPageMask({
  originalWindows,
}: {
  originalWindows: readonly Box[];
}) {
  const maskId = `pdf-translation-${useId().replace(/:/g, '')}`;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      data-pdf-translation-page-mask="true"
      preserveAspectRatio="none"
      viewBox="0 0 1000 1000"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000" style={{ maskType: 'luminance' }}>
          <rect x="0" y="0" width="1000" height="1000" fill="white" />
          {originalWindows.map(([left, top, right, bottom], index) => (
            <rect key={index} x={left} y={top} width={right - left} height={bottom - top} fill="black" />
          ))}
        </mask>
      </defs>
      <rect x="0" y="0" width="1000" height="1000" fill="white" mask={`url(#${maskId})`} />
    </svg>
  );
});
