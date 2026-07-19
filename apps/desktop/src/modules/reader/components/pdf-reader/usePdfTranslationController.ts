import { useEffect, useMemo, useRef, useState } from "react";

import { translateEntrySegment } from "@/shared/ipc/workspaceApi";
import { useToast } from "@/shared/hooks/useToast";
import type { SourceSegment } from "@/shared/types/domain";

import {
  buildTranslationExportMarkdown,
  buildTranslationExportTitle,
} from "../../translation/translationExport";
import {
  useEntryTranslationTask,
  type TranslationRunStrategy,
  type TranslationStartOptions,
} from "../../translation/useEntryTranslationTask";
import {
  describeTranslationFailure,
  PARTIAL_TRANSLATION_FAILURE,
} from "../../translation/translationErrorMessage";

type UsePdfTranslationControllerOptions = {
  entryId: string;
  entryTitle: string;
  loadReady: boolean;
  onExportTranslationNote: (
    entryId: string,
    title: string,
    markdown: string,
  ) => Promise<void>;
  segments: SourceSegment[];
  workspaceRoot: string | null;
};

export function usePdfTranslationController({
  entryId,
  entryTitle,
  loadReady,
  onExportTranslationNote,
  segments,
  workspaceRoot,
}: UsePdfTranslationControllerOptions) {
  const { dismiss, notify } = useToast();
  const [taskOpen, setTaskOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [translatingSegmentUid, setTranslatingSegmentUid] = useState<string | null>(null);
  const handledJobKeyRef = useRef<string | null>(null);
  const {
    activeJob,
    currentJobKey,
    pauseTranslation: pauseTask,
    startTranslation: startTask,
    translation,
    translationBusy,
    translationDetail,
    translationMessage,
    reloadTranslation,
  } = useEntryTranslationTask({ entryId, workspaceRoot });

  const bySegmentUid = useMemo(
    () =>
      new Map(
        (translation?.segments ?? [])
          .filter(
            (segment) =>
              segment.status === "translated" && segment.translated_text,
          )
          .map((segment) => [segment.segment_uid, segment]),
      ),
    [translation],
  );
  const canResume =
    translation?.status === "failed" ||
    translation?.status === "partial" ||
    translation?.status === "running";
  const hasRetryableFailures =
    !translationBusy && (translation?.progress.failed ?? 0) > 0;

  useEffect(() => {
    handledJobKeyRef.current = null;
  }, [entryId]);

  useEffect(() => {
    if (!currentJobKey || !activeJob) {
      return;
    }
    if (handledJobKeyRef.current === currentJobKey) {
      return;
    }
    if (activeJob.status === "processing" || activeJob.status === "queued") {
      return;
    }

    handledJobKeyRef.current = currentJobKey;
    if (activeJob.status === "failed") {
      notify({
        tone: "danger",
        title: "翻译失败",
        description: describeTranslationFailure(
          translation?.error || activeJob.error || activeJob.message,
        ),
      });
      return;
    }
    if (activeJob.status === "canceled") {
      notify({
        title: "已暂停翻译",
        description: "已保留当前翻译进度，可稍后继续。",
      });
      return;
    }
    if (
      translation?.status === "partial" &&
      (translation.progress.failed > 0 || Boolean(translation.error))
    ) {
      notify({
        title: "翻译部分完成",
        description: PARTIAL_TRANSLATION_FAILURE,
      });
      return;
    }
    notify({
      tone: "success",
      title: translation?.status === "partial" ? "所选内容翻译完成" : "翻译完成",
      description:
        translation?.status === "partial"
          ? "已保存所选内容译文，其余内容仍可在翻译任务中继续选择。"
          : "已保存全文翻译。",
    });
  }, [activeJob, currentJobKey, notify, translation]);

  useEffect(() => {
    if (
      loadReady &&
      translation?.segments.some((segment) => segment.status === "translated")
    ) {
      setVisible(true);
    }
  }, [loadReady, translation]);

  const translateSegment = async (segment: SourceSegment) => {
    if (!workspaceRoot || translatingSegmentUid) {
      return;
    }
    setTranslatingSegmentUid(segment.uid);
    const toastId = notify({
      durationMs: Infinity,
      title: "Block 翻译中",
      description: `正在翻译第 ${segment.page_idx + 1} 页片段。`,
    });
    try {
      await translateEntrySegment(workspaceRoot, entryId, segment.uid);
      await reloadTranslation();
      setVisible(true);
      dismiss(toastId);
      notify({
        tone: "success",
        title: "Block 翻译完成",
        description: `第 ${segment.page_idx + 1} 页片段已更新。`,
      });
    } catch (caught) {
      dismiss(toastId);
      notify({
        tone: "danger",
        title: "Block 翻译失败",
        description: describeTranslationFailure(caught),
      });
    } finally {
      dismiss(toastId);
      setTranslatingSegmentUid(null);
    }
  };

  const start = async (
    strategy: TranslationRunStrategy,
    options: TranslationStartOptions = {},
  ) => {
    if (!workspaceRoot || translationBusy || !loadReady) {
      return;
    }
    try {
      setVisible(true);
      await startTask(strategy, options);
    } catch (caught) {
      notify({
        tone: "danger",
        title: "翻译失败",
        description: describeTranslationFailure(caught),
      });
    }
  };

  const pause = async () => {
    if (!translationBusy) {
      return;
    }
    try {
      await pauseTask();
    } catch (caught) {
      void caught;
      notify({
        tone: "danger",
        title: "暂停翻译失败",
        description: "暂时无法暂停翻译，请稍后重试。",
      });
    }
  };

  const exportTranslation = async () => {
    if (!translation) {
      return;
    }
    try {
      const markdown = buildTranslationExportMarkdown({
        entryTitle,
        sourceSegments: segments,
        translation,
      });
      await onExportTranslationNote(
        entryId,
        buildTranslationExportTitle(entryTitle),
        markdown,
      );
      notify({
        tone: "success",
        title: "导出完成",
        description: "已生成翻译笔记。",
      });
    } catch (caught) {
      notify({
        tone: "danger",
        title: "导出翻译失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    }
  };

  return {
    bySegmentUid,
    canResume,
    exportTranslation,
    hasRetryableFailures,
    pause,
    retryFailed: () => start("resume"),
    setTaskOpen,
    setVisible,
    start,
    taskOpen,
    translateSegment,
    translatingSegmentUid,
    translation,
    translationBusy,
    translationDetail,
    translationJobProgress: activeJob?.progress ?? null,
    translationMessage,
    translationMode: "hover" as const,
    visible,
  };
}
