/** User-facing terminology. Keep domain types and persisted fields in English. */
export const UI_TERMS = {
  annotation: '批注',
  entry: '条目',
  reflow: '重排版',
  segment: '原文片段',
  segmentNote: '片段笔记',
  sourceLink: '来源链接'
} as const;

export function pageLabel(pageIndex: number) {
  return `第 ${pageIndex + 1} 页`;
}

export function sourceLocationLabel(entryTitle: string, pageIndex: number, segmentUid?: string | null) {
  return [entryTitle, pageLabel(pageIndex), segmentUid ? `${UI_TERMS.segment} ${segmentUid}` : null]
    .filter(Boolean)
    .join(' · ');
}
