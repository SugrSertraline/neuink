import { useMemo } from 'react';
import { ReflowReader } from '@/modules/reader/components/reflow/ReflowReader';
import { ReadingNavigationScope, segmentTarget, useReadingNavigation } from '@/modules/reader/components/navigation/ReadingNavigation';
import { ReadingViewSession } from '@/modules/reader/components/navigation/ReadingViewSession';
import { readStoredReaderPreferences, type ReadingLinkMode } from '@/shared/lib/readerPreferences';
import type { SourceSegment } from '@/shared/types/domain';

const noop = () => undefined;
export function ReadingLinkReflowPreview({ entryId, segments, linkMode }: { entryId: string; segments: SourceSegment[]; linkMode: ReadingLinkMode }) {
  return <ReadingViewSession workspaceRoot="preview" active surface={{ kind: 'reflow', entryId, viewId: 'right' }} linkMode={linkMode}>
    <ReadingNavigationScope><ReflowPreviewBody entryId={entryId} segments={segments} /></ReadingNavigationScope>
  </ReadingViewSession>;
}
function ReflowPreviewBody({ entryId, segments }: { entryId: string; segments: SourceSegment[] }) {
  const nav = useReadingNavigation()!;
  const prefs = useMemo(readStoredReaderPreferences, []);
  const empty = useMemo(() => ({ annotations: new Map(), notes: new Map(), links: new Map(), translations: new Map(), hidden: new Set<string>() }), []);
  return <div className="flex min-h-0 min-w-0 flex-col border-l">
    <div className="shrink-0 border-b px-3 py-2 text-sm">重排阅读 · 对照 PDF 原文</div>
    <div className="min-h-0 flex-1"><ReflowReader entryId={entryId} segments={segments} workspaceRoot={null}
      activeSegmentUid={null} flashSegmentUid={null} pdfDocument={null}
      annotationsBySegmentUid={empty.annotations} notesBySegmentUid={empty.notes} sourceLinkCountBySegmentUid={empty.links}
      translationBySegmentUid={empty.translations} hiddenSegmentUids={empty.hidden} sourceBacklinksBySegmentUid={{}}
      hoverPreviewEnabled={false} hoverPreviewShowOriginal={false} hoverPreviewShowTranslation={false}
      hoverPreviewShowNote={false} hoverPreviewShowAnnotation={false} paperReferenceHoverEnabled={false}
      reflowComponents={prefs.reflowComponents} reflowBackgroundColor={prefs.reflowBackgroundColor}
      reflowFontSize={prefs.reflowFontSize} reflowTranslationMode="source"
      onActivateSegment={segment => nav.linkTarget(segmentTarget(segment))} onOpenSegmentAnnotation={noop}
      onOpenSegmentNote={noop} onRequirePdfDocument={noop} onHideSegment={noop} onCopyContent={noop}
      onCopySourceLink={noop} onOpenSourceBacklink={noop} /></div>
  </div>;
}
