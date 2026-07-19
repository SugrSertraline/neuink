import type { ReflowSegmentGroup } from './buildReflowBlocks';

export function buildReflowGroupIndex(groups: ReflowSegmentGroup[]) {
  const indexBySegmentUid = new Map<string, number>();

  groups.forEach((group, index) => {
    indexBySegmentUid.set(group.body.uid, index);
    for (const segment of group.segments) {
      indexBySegmentUid.set(segment.uid, index);
    }
  });

  return indexBySegmentUid;
}

export function estimateReflowGroupSize(
  group: ReflowSegmentGroup,
  translationMode: 'bilingual' | 'source' | 'translation'
) {
  if (group.kind === 'visual') {
    return 520;
  }

  const segment = group.body;
  const content = segment.markdown ?? segment.text;
  const wrappedLines = Math.max(
    content.split(/\r?\n/).length,
    Math.ceil(content.length / 72)
  );
  const contentHeight = Math.min(560, Math.max(36, wrappedLines * 27));
  const chromeHeight = segment.segment_type === 'heading' ? 116 : 82;
  const translationMultiplier = translationMode === 'bilingual' ? 1.75 : 1;

  return Math.ceil((contentHeight + chromeHeight) * translationMultiplier);
}
