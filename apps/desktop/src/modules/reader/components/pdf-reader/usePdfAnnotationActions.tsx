import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/shared/hooks/useToast";
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  AnnotationTextSelection,
} from "@/shared/types/domain";

export type PdfAnnotationDraft = {
  annotationId?: AnnotationId | null;
  content: string;
  importance: AnnotationImportance;
  kind: string;
  segmentUid: string;
  textSelection?: AnnotationTextSelection | null;
};

type UsePdfAnnotationActionsOptions = {
  annotations: Annotation[];
  entryId: string;
  onDeleteAnnotation: (
    entryId: string,
    annotationId: AnnotationId,
  ) => Promise<Annotation[]>;
  onSaveAnnotation: (
    entryId: string,
    annotation: PdfAnnotationDraft,
  ) => Promise<Annotation[]>;
  setAnnotations: (annotations: Annotation[]) => void;
};

export function usePdfAnnotationActions({
  annotations,
  entryId,
  onDeleteAnnotation,
  onSaveAnnotation,
  setAnnotations,
}: UsePdfAnnotationActionsOptions) {
  const { dismiss, notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState<AnnotationId | null>(null);
  const pendingDeleteRef = useRef(new Set<AnnotationId>());

  const save = async (draft: PdfAnnotationDraft) => {
    setBusy(true);
    try {
      const previousIds = new Set(
        annotations.map((annotation) => annotation.annotation_id),
      );
      const nextAnnotations = await onSaveAnnotation(entryId, draft);
      setAnnotations(nextAnnotations);
      const created = nextAnnotations.find(
        (annotation) =>
          annotation.segment_uid === draft.segmentUid &&
          !previousIds.has(annotation.annotation_id),
      );
      const annotationLabel = draft.textSelection
        ? draft.content.trim()
          ? "选区批注"
          : "高亮"
        : "片段批注";
      notify({
        tone: "success",
        title: `${annotationLabel}已${draft.annotationId ? "更新" : "创建"}`,
        description: created
          ? (created.content || created.text_selection?.text || "").slice(0, 48)
          : undefined,
      });
      return draft.annotationId
        ? (nextAnnotations.find(
            (annotation) => annotation.annotation_id === draft.annotationId,
          ) ?? null)
        : (created ?? null);
    } catch (caught) {
      notify({
        tone: "danger",
        title: draft.annotationId ? "更新批注失败" : "创建批注失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const deleteNow = async (annotationId: AnnotationId) => {
    pendingDeleteRef.current.delete(annotationId);
    setBusy(true);
    try {
      const nextAnnotations = await onDeleteAnnotation(entryId, annotationId);
      setAnnotations(nextAnnotations);
      notify({ tone: "success", title: "批注已删除" });
    } catch (caught) {
      notify({
        tone: "danger",
        title: "删除批注失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy(false);
    }
  };

  const scheduleDelete = (annotationId: AnnotationId) => {
    if (pendingDeleteRef.current.has(annotationId)) {
      return;
    }

    pendingDeleteRef.current.add(annotationId);
    let toastId = "";
    toastId = notify({
      action: (
        <Button
          size="xs"
          type="button"
          variant="outline"
          onClick={() => {
            pendingDeleteRef.current.delete(annotationId);
            dismiss(toastId);
          }}
        >
          撤销
        </Button>
      ),
      description: "倒计时结束后将从当前条目中删除这条批注。",
      durationMs: 5200,
      onExpire: () => {
        if (!pendingDeleteRef.current.has(annotationId)) {
          return;
        }
        void deleteNow(annotationId);
      },
      showProgress: true,
      title: "批注即将删除",
    });
  };

  return {
    busy,
    focusId,
    save,
    scheduleDelete,
    setFocusId,
  };
}
