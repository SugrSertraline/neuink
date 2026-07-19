export type SourceLinkClipboardPayload = {
  sourceEntryId: string;
  segmentUid: string;
};

const SOURCE_LINK_CLIPBOARD_URL = 'neuink-source://segment';
const SOURCE_LINK_CLIPBOARD_PATTERN = /neuink-source:\/\/segment\?[^\s<>)\]]+/g;

export function formatSourceLinkClipboardMarker({
  sourceEntryId,
  segmentUid
}: SourceLinkClipboardPayload) {
  const params = new URLSearchParams({
    sourceEntryId,
    segmentUid
  });

  return `${SOURCE_LINK_CLIPBOARD_URL}?${params.toString()}`;
}

export function parseSourceLinkClipboardPayload(text: string): SourceLinkClipboardPayload | null {
  for (const match of text.matchAll(SOURCE_LINK_CLIPBOARD_PATTERN)) {
    const marker = match[0];

    try {
      const url = new URL(marker);
      if (url.protocol !== 'neuink-source:' || url.hostname !== 'segment') {
        continue;
      }

      const sourceEntryId = url.searchParams.get('sourceEntryId')?.trim() ?? '';
      const segmentUid = url.searchParams.get('segmentUid')?.trim() ?? '';
      if (!sourceEntryId || !segmentUid) {
        continue;
      }

      return { sourceEntryId, segmentUid };
    } catch {
      continue;
    }
  }

  return null;
}
