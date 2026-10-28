import type { PreviewAnchor } from '@/components/ui/pointer-preview';
import { alignSavedTranslation } from '../../translation/sentenceAlignment';
import type { PdfSentenceGeometry } from './pdfSentenceHover';
import type { SegmentRegionItem } from './types';

export type PdfSentenceHover = { regionId: string; sentence: PdfSentenceGeometry | null };

/** A missing sentence match must not discard the saved paragraph translation. */
export function pdfSentencePreview(hovered: PdfSentenceHover, region: SegmentRegionItem, translated: string | null | undefined,
  pageRect: DOMRect) {
  const paragraphTranslation = translated?.trim() || null;
  const sentence = hovered.sentence;
  const index = sentence?.linkedSentenceIndex ?? null;
  const paired = paragraphTranslation && index !== null
    ? alignSavedTranslation(region.sourceSegment.markdown ?? region.sourceSegment.text, paragraphTranslation) : null;
  const translation = paired?.find(pair => index !== null && index >= pair.sourceStartIndex && index < pair.sourceEndIndex)
    ?.translation.trim() || null;
  const rects = sentence?.rects.length ? sentence.rects : [region.bbox];
  const first = rects[0];
  const anchor: PreviewAnchor = {
    x: pageRect.left + first[0] / 1000 * pageRect.width,
    right: pageRect.left + Math.max(...rects.map(rect => rect[2])) / 1000 * pageRect.width,
    top: pageRect.top + first[1] / 1000 * pageRect.height,
    bottom: pageRect.top + Math.max(...rects.map(rect => rect[3])) / 1000 * pageRect.height,
  };
  return {
    regionId: region.id, anchor, source: sentence?.source ?? '', translation, paragraphTranslation,
    paragraphPosition: {
      x: pageRect.left + region.bbox[0] / 1000 * pageRect.width,
      segmentRight: pageRect.left + region.bbox[2] / 1000 * pageRect.width,
      segmentTop: pageRect.top + region.bbox[1] / 1000 * pageRect.height,
      segmentBottom: pageRect.top + region.bbox[3] / 1000 * pageRect.height,
    },
  };
}
