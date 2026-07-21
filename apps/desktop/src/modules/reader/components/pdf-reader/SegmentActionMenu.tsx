import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  ClipboardCopy,
  EyeOff,
  ImagePlus,
  Languages,
  Link2,
  MessageSquarePlus,
  PanelRightOpen,
  Pencil,
  StickyNote,
} from "lucide-react";

import type { SourceSegment } from "@/shared/types/domain";

import type { SourceBacklink } from "../../types";
import { segmentTypeLabel } from "./readerUtils";

export function SegmentActionMenu({
  canAddSourceLink,
  canCopyContent,
  canCopySourceLink,
  canInsertSegmentImage = false,
  position,
  segment,
  onAddAssistantContext,
  onAddSourceLink,
  onCopyContent,
  onCopySourceLink,
  onInsertSegmentImage,
  onTranslateSegment,
  onOpenSegmentAnnotation,
  onOpenSegmentNote,
  onOpenSegmentWorkspace,
  onHideSegment,
  sourceBacklinks,
  onOpenSourceBacklink,
  onClose,
}: {
  canAddSourceLink: boolean;
  canCopyContent: boolean;
  canCopySourceLink: boolean;
  canInsertSegmentImage?: boolean;
  position: { x: number; y: number };
  segment: SourceSegment;
  sourceBacklinks: SourceBacklink[];
  onAddAssistantContext?: (segment: SourceSegment) => void;
  onAddSourceLink?: (segment: SourceSegment) => void;
  onCopyContent?: (segment: SourceSegment) => void;
  onCopySourceLink?: (segment: SourceSegment) => void;
  onInsertSegmentImage?: (segment: SourceSegment) => void;
  onTranslateSegment?: (segment: SourceSegment) => void;
  onOpenSegmentAnnotation: (segment: SourceSegment) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onOpenSegmentWorkspace?: (segment: SourceSegment) => void;
  onHideSegment?: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[var(--z-menu)] min-w-56 overflow-hidden rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
      data-allow-context-menu="true"
      style={{
        left: `clamp(0.5rem, ${position.x}px, calc(100vw - 15rem))`,
        top: `clamp(0.5rem, ${position.y}px, calc(100vh - 16rem))`,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="border-b px-2 py-1.5 text-[11px] text-muted-foreground">
        {segmentTypeLabel(segment.segment_type)} · 第 {segment.page_idx + 1} 页
      </div>
      {sourceBacklinks.length > 0 ? (
        <div className="border-b px-2 py-1.5">
          <div className="text-[11px] font-semibold text-foreground">
            {sourceBacklinks.length} 个笔记引用
          </div>
          <div className="mt-1 grid gap-1">
            {sourceBacklinks.slice(0, 4).map((backlink) => (
              <button
                className="min-w-0 rounded-sm bg-muted/60 px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted"
                key={backlink.linkId}
                title={`${backlink.noteEntryTitle} · ${backlink.noteTitle}`}
                type="button"
                onClick={() => {
                  onOpenSourceBacklink(backlink);
                  onClose();
                }}
              >
                <div className="truncate font-medium text-foreground">
                  {backlink.noteTitle}
                </div>
                <div className="truncate">{backlink.noteEntryTitle}</div>
              </button>
            ))}
            {sourceBacklinks.length > 4 ? (
              <div className="px-2 text-[11px] text-muted-foreground">
                还有 {sourceBacklinks.length - 4} 个引用
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <MenuButton
        disabled={false}
        icon={<StickyNote size={13} aria-hidden="true" />}
        label="编辑片段笔记（浮窗）"
        onClick={() => {
          onOpenSegmentNote(segment);
          onClose();
        }}
      />
      <MenuButton
        disabled={false}
        icon={<Pencil size={13} aria-hidden="true" />}
        label="添加批注或高亮（浮窗）"
        onClick={() => {
          onOpenSegmentAnnotation(segment);
          onClose();
        }}
      />
      {onOpenSegmentWorkspace ? (
        <>
          <div className="my-1 border-t" />
          <MenuButton
            disabled={false}
            icon={<PanelRightOpen size={13} aria-hidden="true" />}
            label="在分屏中打开片段记录"
            onClick={() => {
              onOpenSegmentWorkspace(segment);
              onClose();
            }}
          />
          <div className="my-1 border-t" />
        </>
      ) : null}
      {onHideSegment ? (
        <MenuButton
          disabled={false}
          icon={<EyeOff size={13} aria-hidden="true" />}
          label="隐藏重排版元素"
          onClick={() => {
            onHideSegment(segment);
            onClose();
          }}
        />
      ) : null}
      <MenuButton
        disabled={!onAddAssistantContext}
        icon={<MessageSquarePlus size={13} aria-hidden="true" />}
        label="加入对话上下文"
        onClick={() => {
          onAddAssistantContext?.(segment);
          onClose();
        }}
      />
      {onTranslateSegment ? (
        <MenuButton
          disabled={false}
          icon={<Languages size={13} aria-hidden="true" />}
          label="翻译此片段"
          onClick={() => {
            onTranslateSegment(segment);
            onClose();
          }}
        />
      ) : null}
      <MenuButton
        disabled={!canCopyContent || !onCopyContent}
        icon={<ClipboardCopy size={13} aria-hidden="true" />}
        label="复制内容"
        onClick={() => {
          onCopyContent?.(segment);
          onClose();
        }}
      />
      <MenuButton
        disabled={!canCopySourceLink || !onCopySourceLink}
        icon={<ClipboardCopy size={13} aria-hidden="true" />}
        label="复制来源链接"
        onClick={() => {
          onCopySourceLink?.(segment);
          onClose();
        }}
      />
      {onInsertSegmentImage ? (
        <MenuButton
          disabled={!canInsertSegmentImage || !segment.asset_path}
          icon={<ImagePlus size={13} aria-hidden="true" />}
          label="插入片段图片"
          onClick={() => {
            onInsertSegmentImage(segment);
            onClose();
          }}
        />
      ) : null}
      {canAddSourceLink && onAddSourceLink ? (
        <MenuButton
          disabled={false}
          icon={<Link2 size={13} aria-hidden="true" />}
          label="插入到分屏笔记"
          onClick={() => {
            onAddSourceLink(segment);
            onClose();
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function MenuButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  const runAction = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };

  return (
    <button
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      type="button"
      onClick={runAction}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
