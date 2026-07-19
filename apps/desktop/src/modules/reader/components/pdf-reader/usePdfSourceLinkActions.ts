import { useState } from "react";

import { useToast } from "@/shared/hooks/useToast";
import { formatSourceLinkClipboardMarker } from "@/shared/lib/sourceLinkClipboard";
import type { SourceLink, SourceSegment } from "@/shared/types/domain";

import type { MarkdownNoteTarget, SourceClipboardItem } from "../../types";

type UsePdfSourceLinkActionsOptions = {
  activeTarget: MarkdownNoteTarget | null;
  entryId: string;
  entryTitle: string;
  onCreateMarkdownSourceLink: (
    entryId: string,
    noteId: string,
    sourceEntryId: string,
    segmentUid: string,
  ) => Promise<SourceLink>;
  onEnsureNotePaneOpen: () => void;
  onQueuePendingSourceLinkInsertion: (
    entryId: string,
    noteId: string,
    link: SourceLink,
  ) => void;
};

export function usePdfSourceLinkActions({
  activeTarget,
  entryId,
  entryTitle,
  onCreateMarkdownSourceLink,
  onEnsureNotePaneOpen,
  onQueuePendingSourceLinkInsertion,
}: UsePdfSourceLinkActionsOptions) {
  const { notify } = useToast();
  const [clipboard, setClipboard] = useState<SourceClipboardItem | null>(null);
  const [busySegmentUid, setBusySegmentUid] = useState<string | null>(null);

  const createAndQueue = async (sourceEntryId: string, segmentUid: string) => {
    if (!activeTarget || busySegmentUid) {
      return;
    }
    setBusySegmentUid(segmentUid);
    onEnsureNotePaneOpen();
    try {
      const link = await onCreateMarkdownSourceLink(
        activeTarget.entryId,
        activeTarget.noteId,
        sourceEntryId,
        segmentUid,
      );
      onQueuePendingSourceLinkInsertion(
        activeTarget.entryId,
        activeTarget.noteId,
        link,
      );
    } catch (caught) {
      notify({
        tone: "danger",
        title: "插入来源链接失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusySegmentUid(null);
    }
  };

  const createFromSegment = async (segment: SourceSegment) => {
    await createAndQueue(entryId, segment.uid);
  };

  const copy = async (segment: SourceSegment) => {
    const snapshotText = segment.markdown ?? segment.text;
    setClipboard({
      pageIdx: segment.page_idx,
      segmentUid: segment.uid,
      sourceEntryId: entryId,
      sourceEntryTitle: entryTitle,
      snapshotText,
    });

    const clipboardText = buildCopiedSourceText(
      entryTitle,
      segment.page_idx,
      entryId,
      segment.uid,
      snapshotText,
    );
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardText);
      }
      notify({
        tone: "success",
        title: "来源已复制",
        description: `${entryTitle} · p.${segment.page_idx + 1}`,
      });
    } catch (caught) {
      notify({
        tone: "danger",
        title: "复制来源失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  const copyContent = async (segment: SourceSegment) => {
    const content = (segment.markdown ?? segment.text).trim();
    if (!content) {
      notify({
        tone: "danger",
        title: "片段没有可复制的内容",
      });
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("当前环境不支持系统剪贴板。");
      }
      await navigator.clipboard.writeText(content);
      notify({
        tone: "success",
        title: "已复制片段内容",
      });
    } catch (caught) {
      notify({
        tone: "danger",
        title: "复制片段内容失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  const insertCopied = async () => {
    if (!clipboard) {
      return;
    }
    await createAndQueue(clipboard.sourceEntryId, clipboard.segmentUid);
  };

  return {
    clipboard,
    copy,
    copyContent,
    createFromSegment,
    insertCopied,
  };
}

function buildCopiedSourceText(
  entryTitle: string,
  pageIdx: number,
  entryId: string,
  segmentUid: string,
  snapshotText: string,
) {
  const marker = formatSourceLinkClipboardMarker({
    sourceEntryId: entryId,
    segmentUid,
  });
  const normalizedSnapshot = snapshotText.replace(/\s+/g, " ").trim();
  const excerpt =
    normalizedSnapshot.length > 140
      ? `${normalizedSnapshot.slice(0, 140)}…`
      : normalizedSnapshot;
  return [
    `${entryTitle} · p.${pageIdx + 1}`,
    excerpt,
    marker,
  ]
    .filter(Boolean)
    .join("\n");
}
