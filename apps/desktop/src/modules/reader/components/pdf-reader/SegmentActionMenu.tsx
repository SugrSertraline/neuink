import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { SegmentBookmarkButton } from '../SegmentBookmarks';
import { SegmentMenuButton as MenuButton } from '../SegmentMenuButton';
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
import { ViewportOverlay } from '@/components/ui/viewport-overlay';

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
  translationActions,
  displayActions,
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
  translationActions?: ReactNode;
  displayActions?: ReactNode;
  onOpenSegmentAnnotation: (segment: SourceSegment) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onOpenSegmentWorkspace?: (segment: SourceSegment) => void;
  onHideSegment?: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const viewport = viewportRef.current;
    if (!menu || !viewport) return;
    const place = () => {
      const bounds = viewport.getBoundingClientRect();
      const scale = bounds.width / viewport.clientWidth || 1;
      menu.style.maxHeight = `${Math.max(0, viewport.clientHeight - 16)}px`;
      menu.style.maxWidth = `${Math.max(0, viewport.clientWidth - 16)}px`;
      menu.style.left = `${Math.max(8, Math.min((position.x - bounds.left) / scale, viewport.clientWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min((position.y - bounds.top) / scale, viewport.clientHeight - menu.offsetHeight - 8))}px`;
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(menu);
    observer?.observe(viewport);
    const previous = document.activeElement;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      observer?.disconnect();
      if (previous instanceof HTMLElement && previous.isConnected && menu.contains(document.activeElement)) previous.focus({ preventScroll: true });
    };
  }, [position.x, position.y]);

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
    const close = (event: Event) => {
      if (event.type === 'scroll' && event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
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
    <ViewportOverlay enabled ref={viewportRef}>
    <div
      ref={menuRef}
      role="menu"
      aria-label="段落操作"
      className="absolute z-[var(--z-menu)] w-60 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
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
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
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
      <SegmentBookmarkButton segment={segment} menu onDone={onClose} />
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
      {translationActions ?? (onTranslateSegment ? (
        <MenuButton
          disabled={false}
          icon={<Languages size={13} aria-hidden="true" />}
          label="翻译此片段"
          onClick={() => {
            onTranslateSegment(segment);
            onClose();
          }}
        />
      ) : null)}
      {displayActions}
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
    </div>
    </ViewportOverlay>,
    document.body,
  );
}
