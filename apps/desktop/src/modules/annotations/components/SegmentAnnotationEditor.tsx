import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { pageLabel } from "@/shared/lib/uiTerminology";
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  SourceSegment,
} from "@/shared/types/domain";

import {
  ANNOTATION_TYPES,
  IMPORTANCE_OPTIONS,
  annotationImportanceLabel,
  annotationImportanceRank,
  annotationKindLabel,
  getAnnotationTypeDefinition,
} from "../annotationRegistry";
import { segmentTypeLabel } from "../../reader/components/pdf-reader/readerUtils";
import { SegmentSourceContextPreview } from "../../reader/components/pdf-reader/SegmentSourceContextPreview";
import {
  registerSegmentEditorCloseHandler,
  setSegmentEditorDirty,
} from "../../reader/components/segmentEditorDirtyRegistry";
import {
  ReaderEmptyState,
  ReaderModeSwitch,
} from "../../reader/components/ReaderSurfacePrimitives";

type EditorMode = "idle" | "create" | "edit";

type AnnotationDraft = {
  annotationId: AnnotationId | null;
  content: string;
  importance: AnnotationImportance;
  kind: string;
};

export function SegmentAnnotationEditor({
  annotations,
  busy,
  className,
  draftScopeKey,
  onClose,
  onDelete,
  onModeChange,
  onSave,
  pdfDocument,
  relatedSegmentUids,
  selectedAnnotationId: focusedAnnotationId,
  showCloseButton = true,
  sourceInitiallyExpanded = false,
  segment,
  segments,
  sourceEntryId,
  workspaceRoot,
}: {
  annotations: Annotation[];
  busy: boolean;
  className?: string;
  draftScopeKey?: string;
  onClose: () => void;
  onDelete: (annotationId: AnnotationId) => void;
  onModeChange: (mode: "segment" | "annotation") => void;
  onSave: (draft: {
    annotationId?: AnnotationId | null;
    content: string;
    importance: AnnotationImportance;
    kind: string;
    segmentUid: string;
  }) => Promise<unknown> | unknown;
  pdfDocument?: PDFDocumentProxy | null;
  relatedSegmentUids?: string[];
  selectedAnnotationId?: AnnotationId | null;
  showCloseButton?: boolean;
  sourceInitiallyExpanded?: boolean;
  segment: SourceSegment | null;
  segments: SourceSegment[];
  sourceEntryId: string;
  workspaceRoot: string | null;
}) {
  const ownerId = `segment-annotation:${useId()}`;
  const [editorMode, setEditorMode] = useState<EditorMode>("idle");
  const [selectedAnnotationId, setSelectedAnnotationId] =
    useState<AnnotationId | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Annotation | null>(null);
  const [draft, setDraft] = useState<AnnotationDraft>(emptyDraft());
  const appliedFocusedAnnotationIdRef = useRef<AnnotationId | null>(null);
  const pendingSaveRef = useRef<{
    annotationId: AnnotationId | null;
    content: string;
    existingIds: AnnotationId[];
    segmentUid: string;
  } | null>(null);

  const segmentByUid = useMemo(
    () => new Map(segments.map((item) => [item.uid, item])),
    [segments],
  );
  const currentSegmentUid = segment?.uid ?? null;
  const currentSegmentUids = useMemo(
    () => new Set(relatedSegmentUids ?? (currentSegmentUid ? [currentSegmentUid] : [])),
    [currentSegmentUid, relatedSegmentUids],
  );
  const currentSegmentAnnotations = useMemo(
    () =>
      annotations
        .filter((annotation) => currentSegmentUids.has(annotation.segment_uid))
        .sort(compareAnnotations),
    [annotations, currentSegmentUids],
  );
  const selectedAnnotation = selectedAnnotationId
    ? (currentSegmentAnnotations.find(
        (annotation) => annotation.annotation_id === selectedAnnotationId,
      ) ?? null)
    : null;
  const highlightSelections = useMemo(
    () => currentSegmentAnnotations.flatMap((annotation) =>
      annotation.text_selection ? [annotation.text_selection] : []
    ),
    [currentSegmentAnnotations]
  );
  const editingAnnotation = editorMode === "edit" ? selectedAnnotation : null;

  useEffect(() => {
    appliedFocusedAnnotationIdRef.current = null;
    pendingSaveRef.current = null;
    setEditorMode("idle");
    setSelectedAnnotationId(null);
    setDeleteTarget(null);
    setDraft(emptyDraft());
  }, [currentSegmentUid]);

  useEffect(() => {
    if (!segment) {
      return;
    }

    if (
      focusedAnnotationId &&
      appliedFocusedAnnotationIdRef.current !== focusedAnnotationId
    ) {
      const focusedAnnotation = currentSegmentAnnotations.find(
        (annotation) => annotation.annotation_id === focusedAnnotationId,
      );
      if (focusedAnnotation) {
        appliedFocusedAnnotationIdRef.current = focusedAnnotationId;
        setSelectedAnnotationId(focusedAnnotation.annotation_id);
        setEditorMode("idle");
        setDraft(emptyDraft());
      }
    }
  }, [currentSegmentAnnotations, focusedAnnotationId, segment]);

  useEffect(() => {
    if (!selectedAnnotationId || currentSegmentAnnotations.length === 0) {
      return;
    }

    const currentSelection = currentSegmentAnnotations.find(
      (annotation) => annotation.annotation_id === selectedAnnotationId,
    );
    if (!currentSelection) {
      setSelectedAnnotationId(
        currentSegmentAnnotations[0]?.annotation_id ?? null,
      );
      if (editorMode === "edit") {
        setEditorMode("idle");
        setDraft(emptyDraft());
      }
    }
  }, [currentSegmentAnnotations, editorMode, selectedAnnotationId]);

  useEffect(() => {
    const pendingSave = pendingSaveRef.current;
    if (
      busy ||
      !segment ||
      !pendingSave ||
      pendingSave.segmentUid !== currentSegmentUid
    ) {
      return;
    }

    const savedAnnotation = pendingSave.annotationId
      ? currentSegmentAnnotations.find(
          (annotation) => annotation.annotation_id === pendingSave.annotationId,
        )
      : (currentSegmentAnnotations.find(
          (annotation) =>
            !pendingSave.existingIds.includes(annotation.annotation_id),
        ) ??
        currentSegmentAnnotations.find(
          (annotation) => annotation.content === pendingSave.content,
        ) ??
        currentSegmentAnnotations[0] ??
        null);

    if (savedAnnotation) {
      pendingSaveRef.current = null;
      setSelectedAnnotationId(savedAnnotation.annotation_id);
      setEditorMode("idle");
      setDraft(emptyDraft());
    }
  }, [busy, currentSegmentAnnotations, currentSegmentUid, segment]);

  const dirty = useMemo(() => {
    if (editorMode === "idle") {
      return false;
    }
    const baseline = editingAnnotation
      ? draftFromAnnotation(editingAnnotation)
      : emptyDraft();
    return JSON.stringify(baseline) !== JSON.stringify(draft);
  }, [draft, editingAnnotation, editorMode]);

  const canSave = Boolean(
    segment && draft.kind.trim() && draft.content.trim() && dirty,
  );
  const latestRelatedSegment = selectedAnnotation
    ? (segmentByUid.get(selectedAnnotation.segment_uid) ?? segment)
    : segment;
  const startNewAnnotation = () => {
    setEditorMode("create");
    setSelectedAnnotationId(null);
    setDraft(emptyDraft());
  };

  const startEditAnnotation = (annotation: Annotation) => {
    setSelectedAnnotationId(annotation.annotation_id);
    setEditorMode("edit");
    setDraft(draftFromAnnotation(annotation));
  };

  const cancelEditing = () => {
    setEditorMode("idle");
    setDraft(emptyDraft());
  };

  const saveDraft = async () => {
    if (!segment || !canSave) {
      return !dirty;
    }

    pendingSaveRef.current = {
      annotationId: draft.annotationId,
      content: draft.content.trim(),
      existingIds: currentSegmentAnnotations.map(
        (annotation) => annotation.annotation_id,
      ),
      segmentUid: segment.uid,
    };
    try {
      const result = await onSave({
        annotationId: draft.annotationId,
        content: draft.content,
        importance: draft.importance,
        kind: draft.kind,
        segmentUid: segment.uid,
      });
      const saved = result !== false && result !== null;
      if (!saved) pendingSaveRef.current = null;
      return saved;
    } catch {
      pendingSaveRef.current = null;
      return false;
    }
  };

  useEffect(() => {
    if (!draftScopeKey) return;
    setSegmentEditorDirty(draftScopeKey, ownerId, dirty);
    return () => setSegmentEditorDirty(draftScopeKey, ownerId, false);
  }, [dirty, draftScopeKey, ownerId]);

  useEffect(() => {
    if (!draftScopeKey) return;
    return registerSegmentEditorCloseHandler(draftScopeKey, ownerId, {
      discard: cancelEditing,
      save: saveDraft,
    });
  }, [draftScopeKey, ownerId, saveDraft]);

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }

    onDelete(deleteTarget.annotation_id);
    if (selectedAnnotationId === deleteTarget.annotation_id) {
      setSelectedAnnotationId(null);
    }
    if (draft.annotationId === deleteTarget.annotation_id) {
      setEditorMode("idle");
      setDraft(emptyDraft());
    }
    setDeleteTarget(null);
  };

  return (
    <aside className={cn(
      "grid min-h-0 min-w-0 max-w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-l bg-white",
      className,
    )}>
      <div className="min-w-0 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">当前片段批注</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {segment
                ? `${segmentTypeLabel(segment.segment_type)} · ${pageLabel(segment.page_idx)}`
                : "先选择一个 PDF 片段"}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {busy ? <Badge variant="outline">保存中</Badge> : null}
            {!busy && dirty ? <Badge variant="secondary">未保存</Badge> : null}
            {!busy && !dirty ? (
              <Badge variant="outline">
                {currentSegmentAnnotations.length} 条
              </Badge>
            ) : null}
            {showCloseButton ? (
              <Button
                size="icon-xs"
                title="关闭批注面板"
                type="button"
                variant="ghost"
                onClick={onClose}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <ReaderModeSwitch
          className="mt-2"
          items={[
            { label: "片段笔记", value: "segment" },
            {
              badge: currentSegmentAnnotations.length || null,
              label: "批注",
              value: "annotation",
            },
          ]}
          value="annotation"
          onValueChange={(mode) => {
            if (!dirty) onModeChange(mode);
          }}
        />
      </div>

      <div className="min-h-0 min-w-0 overflow-auto p-3">
        {!segment ? (
          <ReaderEmptyState
            className="min-h-full"
            description="在 PDF 或重排视图中选择原文片段后，可以创建片段批注或选区批注。"
            title="选择一个片段"
          />
        ) : editorMode === "idle" ? (
          <div className="grid min-h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2">
            <SegmentSourceContextPreview
              defaultExpanded={sourceInitiallyExpanded}
              highlightSelections={highlightSelections}
              pdfDocument={pdfDocument}
              segment={segment}
              sourceEntryId={sourceEntryId}
              workspaceRoot={workspaceRoot}
            />

            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">已有批注</span>
                <span>{currentSegmentAnnotations.length}</span>
              </div>
              <Button
                disabled={busy}
                size="sm"
                type="button"
                onClick={startNewAnnotation}
              >
                <Plus size={14} aria-hidden="true" />
                新建
              </Button>
            </div>

            <section className="grid min-h-0 overflow-hidden rounded-md border bg-white">
              <div className="min-h-0 overflow-auto p-2">
                {currentSegmentAnnotations.length === 0 ? (
                  <div className="grid h-full place-items-center rounded-md border border-dashed bg-muted/20 px-4 py-10 text-center">
                    <div className="grid gap-2">
                      <div className="text-sm font-medium text-foreground">
                        当前片段还没有批注
                      </div>
                      <div className="text-xs text-muted-foreground">
                        点击右上角的新建按钮后再填写内容。
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {currentSegmentAnnotations.map((annotation) => {
                      const isSelected =
                        selectedAnnotationId === annotation.annotation_id;
                      return (
                        <AnnotationCard
                          annotation={annotation}
                          key={annotation.annotation_id}
                          selected={isSelected}
                          onDelete={() => setDeleteTarget(annotation)}
                          onEdit={() => startEditAnnotation(annotation)}
                          onSelect={() =>
                            setSelectedAnnotationId(annotation.annotation_id)
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid min-h-full min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
            <SegmentSourceContextPreview
              defaultExpanded={sourceInitiallyExpanded}
              highlightSelections={highlightSelections}
              pdfDocument={pdfDocument}
              segment={segment}
              sourceEntryId={sourceEntryId}
              workspaceRoot={workspaceRoot}
            />
              <AnnotationForm
                busy={busy}
                draft={draft}
                mode={editorMode}
                selectionScoped={Boolean(editingAnnotation?.text_selection)}
              onCancel={cancelEditing}
              onDelete={
                editingAnnotation
                  ? () => setDeleteTarget(editingAnnotation)
                  : undefined
              }
              onDraftChange={setDraft}
            />
          </div>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {editorMode === "create"
            ? "正在创建当前片段的新批注"
            : editorMode === "edit"
              ? latestRelatedSegment
                ? `编辑中 · ${segmentTypeLabel(latestRelatedSegment.segment_type)} · ${pageLabel(
                    latestRelatedSegment.page_idx,
                  )}`
                : editingAnnotation?.text_selection
                  ? "正在编辑选区批注"
                  : "正在编辑片段批注"
              : segment
                ? `当前片段共有 ${currentSegmentAnnotations.length} 条批注`
                : "在 PDF 中选中片段后即可创建批注"}
        </span>

        {editorMode === "idle" ? null : (
          <div className="flex items-center gap-2">
            <Button
              disabled={!canSave || busy || !segment}
              size="sm"
              type="button"
              onClick={() => void saveDraft()}
            >
              {busy ? (
                <Loader2
                  className="animate-spin"
                  size={14}
                  aria-hidden="true"
                />
              ) : null}
              {draft.annotationId ? "保存" : "创建"}
            </Button>
          </div>
        )}
      </div>

      <DeleteAnnotationDialog
        busy={busy}
        target={deleteTarget}
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      />
    </aside>
  );
}

function AnnotationCard({
  annotation,
  selected,
  onDelete,
  onEdit,
  onSelect,
}: {
  annotation: Annotation;
  selected: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "grid w-full gap-2 rounded-md border bg-white px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5",
        selected && "border-primary/35 bg-primary/5",
      )}
      type="button"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <AnnotationTypeBadge label={annotationDisplayLabel(annotation)} />
          <ImportanceBadge importance={annotation.importance} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-xs"
            title="编辑批注"
            type="button"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={13} aria-hidden="true" />
          </Button>
          <Button
            className="text-muted-foreground hover:text-destructive"
            size="icon-xs"
            title="删除批注"
            type="button"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="line-clamp-4 text-sm leading-6 text-foreground">
        {annotation.content}
      </div>
      {annotation.text_selection?.text ? (
        <div className="line-clamp-3 rounded border-l-2 border-amber-300 bg-amber-50/70 px-2 py-1 text-xs leading-5 text-muted-foreground">
          “{annotation.text_selection.text}”
        </div>
      ) : null}
      <div className="text-[11px] text-muted-foreground">
        {formatUpdatedAt(annotation.updated_at)}
      </div>
    </button>
  );
}

function AnnotationForm({
  busy,
  draft,
  mode,
  selectionScoped,
  onCancel,
  onDelete,
  onDraftChange,
}: {
  busy: boolean;
  draft: AnnotationDraft;
  mode: Exclude<EditorMode, "idle">;
  selectionScoped: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onDraftChange: (
    draft: AnnotationDraft | ((current: AnnotationDraft) => AnnotationDraft),
  ) => void;
}) {
  const selectedType = getAnnotationTypeDefinition(draft.kind);

  return (
    <section className="grid min-h-full grid-rows-[auto_auto_minmax(0,1fr)] gap-3 rounded-md border bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {mode === "create"
              ? "新建片段批注"
              : selectionScoped
                ? "编辑选区批注"
                : "编辑片段批注"}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {selectionScoped
              ? "这条批注作用于选中的文字，可补充说明、类型和重要性。"
              : "这条批注作用于整个片段。先选类型和重要性，再写批注正文。"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onDelete ? (
            <Button
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              size="icon-sm"
              title="删除批注"
              type="button"
              variant="ghost"
              onClick={onDelete}
            >
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            disabled={busy}
            size="icon-sm"
            title="取消"
            type="button"
            variant="ghost"
            onClick={onCancel}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            批注类型
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ANNOTATION_TYPES.map((item) => {
              const selected = draft.kind === item.id;
              return (
                <button
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:border-primary/35 hover:bg-primary/5",
                    selected
                      ? "border-primary/45 bg-primary/10 text-primary"
                      : "border-border bg-muted/20 text-foreground",
                  )}
                  key={item.id}
                  title={item.description}
                  type="button"
                  onClick={() =>
                    onDraftChange((current) => ({ ...current, kind: item.id }))
                  }
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            重要性
          </div>
          <StarRating
            value={draft.importance}
            onChange={(importance) =>
              onDraftChange((current) => ({ ...current, importance }))
            }
          />
        </div>

        <div className="rounded-md bg-muted/30 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
          {selectedType?.description ?? "为这个片段写一条清晰、结构化的批注。"}
        </div>
      </div>

      <label className="grid min-h-0 gap-1 text-xs text-muted-foreground">
        <span>批注内容</span>
        <Textarea
          className="min-h-[220px] resize-y px-3 text-sm leading-6"
          placeholder="写下你对这个片段的理解、问题、方法亮点或后续动作..."
          value={draft.content}
          onChange={(event) =>
            onDraftChange((current) => ({
              ...current,
              content: event.target.value,
            }))
          }
        />
      </label>
    </section>
  );
}

function StarRating({
  value,
  onChange,
}: {
  value: AnnotationImportance;
  onChange: (importance: AnnotationImportance) => void;
}) {
  const rank = annotationImportanceRank(value);

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-md border bg-muted/20 px-2 py-1">
        {IMPORTANCE_OPTIONS.map((item) => {
          const itemRank = annotationImportanceRank(item.value);
          return (
            <button
              className="grid size-7 place-items-center rounded text-amber-500 transition-colors hover:bg-amber-100"
              key={item.value}
              title={item.label}
              type="button"
              onClick={() => onChange(item.value)}
              onMouseEnter={() => onChange(item.value)}
            >
              <Star
                className={
                  itemRank <= rank ? "fill-current" : "text-muted-foreground/35"
                }
                size={17}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <span className="text-xs font-medium text-muted-foreground">
        {annotationImportanceLabel(value)}
      </span>
    </div>
  );
}

function DeleteAnnotationDialog({
  busy,
  target,
  onConfirm,
  onOpenChange,
}: {
  busy: boolean;
  target: Annotation | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            删除批注
          </DialogTitle>
          <DialogDescription>
            确认后会进入短暂倒计时，在右下角通知中仍可撤销。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive">
          {target?.content.slice(0, 120) || "这条批注将被删除。"}
        </div>
        <DialogFooter>
          <Button
            disabled={busy}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            disabled={busy}
            type="button"
            variant="destructive"
            onClick={onConfirm}
          >
            <Trash2 size={14} aria-hidden="true" />
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnnotationTypeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
      {label}
    </span>
  );
}

function annotationDisplayLabel(annotation: Annotation) {
  if (annotation.text_selection) {
    return annotation.content.trim() ? "选区批注" : "高亮";
  }
  return annotationKindLabel(annotation.kind);
}

function ImportanceBadge({ importance }: { importance: AnnotationImportance }) {
  const rank = annotationImportanceRank(importance);

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/50 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
      {annotationImportanceLabel(importance)}
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3].map((item) => (
          <Star
            className={item <= rank ? "fill-current" : "text-amber-300/40"}
            key={item}
            size={10}
            aria-hidden="true"
          />
        ))}
      </span>
    </span>
  );
}

function compareAnnotations(left: Annotation, right: Annotation) {
  return (
    annotationImportanceRank(right.importance) -
      annotationImportanceRank(left.importance) ||
    right.updated_at.localeCompare(left.updated_at)
  );
}

function draftFromAnnotation(annotation: Annotation): AnnotationDraft {
  return {
    annotationId: annotation.annotation_id,
    content: annotation.content,
    importance: annotation.importance,
    kind: annotation.kind,
  };
}

function emptyDraft(): AnnotationDraft {
  return {
    annotationId: null,
    content: "",
    importance: "normal",
    kind: ANNOTATION_TYPES[0]?.id ?? "",
  };
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
