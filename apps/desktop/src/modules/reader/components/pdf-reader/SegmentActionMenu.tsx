import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  Pin,
  StickyNote,
  ZoomIn,
} from "lucide-react";

import type { SourceSegment } from "@/shared/types/domain";

import type { SourceBacklink } from "../../types";
import { segmentTypeLabel } from "./readerUtils";
import { ViewportOverlay } from '@/components/ui/viewport-overlay';
import { listItemAddress, listItemSegments } from '@/shared/lib/listItemSegments';
import { useReaderPins } from '../pins/ReaderPinsContext';
import { isVisualSegment } from './usePdfVisualDetail';

export function SegmentActionMenu({
  canAddSourceLink,
  canCopyContent,
  canCopySourceLink,
  canInsertSegmentImage = false,
  position,
  segment: initialSegment,
  wholeListSegment: initialWholeListSegment,
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
  onOpenVisualDetail,
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
  wholeListSegment?: SourceSegment;
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
  onOpenVisualDetail?: (segment: SourceSegment) => void;
  onHideSegment?: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pins = useReaderPins();
  const [choice, setChoice] = useState<SourceSegment | null>(null);
  const segment = choice ?? initialSegment;
  const candidates = listItemSegments(initialSegment);
  const chooseItem = !choice && candidates.length > 1;
  const wholeListSegment = initialWholeListSegment ?? (choice && choice.uid !== initialSegment.uid ? initialSegment : undefined);
  const isListItem = Boolean(listItemAddress(segment.uid));
  const scopeLabel = isListItem ? '列表项' : segmentTypeLabel(segment.segment_type);
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
  }, [position.x, position.y, segment.uid, chooseItem]);
  useEffect(() => setChoice(null), [initialSegment, position]);

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
      aria-label={`${scopeLabel}操作`}
      className="absolute z-[var(--z-menu)] w-72 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
      data-allow-context-menu="true"
      style={{
        left: `clamp(0.5rem, ${position.x}px, calc(100vw - 18rem))`,
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
        <div className="font-medium text-foreground">第 {segment.page_idx + 1} 页 · {scopeLabel}</div>
        <div className="mt-0.5">{chooseItem ? '请选择要操作的列表项' : isListItem ? '以下操作仅针对当前列表项' : `以下操作针对右键处的整个${scopeLabel}`}</div>
      </div>
      {chooseItem ? <>
        {candidates.map((item, index) => <MenuButton key={item.uid} disabled={false} icon={null}
          label={`第 ${index + 1} 项`} description={item.text.length > 100 ? `${item.text.slice(0, 100)}…` : item.text}
          onClick={() => setChoice(item)} />)}
        <div className="my-1 border-t" />
        {onAddAssistantContext ? <MenuButton disabled={false} icon={<MessageSquarePlus size={13} aria-hidden="true" />}
          label="添加整个列表到助手" description="包含当前列表中的所有条目"
          onClick={() => { onAddAssistantContext(initialSegment); onClose(); }} /> : null}
        <MenuButton disabled={false} icon={null} label="操作整个列表" description="对整个列表写笔记、批注或复制"
          onClick={() => setChoice(initialSegment)} />
      </> : <>
      {sourceBacklinks.length > 0 && !(choice && isListItem) ? (
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
      {onOpenVisualDetail && isVisualSegment(segment) ? (
        <MenuButton disabled={false} icon={<ZoomIn size={13} aria-hidden="true" />} label="放大查看"
          description="双击也可打开，支持缩放和拖动"
          onClick={() => { onOpenVisualDetail(segment); onClose(); }} />
      ) : null}
      <MenuButton
        disabled={false}
        icon={<StickyNote size={13} aria-hidden="true" />}
        label="为此处写笔记"
        description="小窗口编辑，保存为关联原文的片段笔记"
        onClick={() => {
          onOpenSegmentNote(segment);
          onClose();
        }}
      />
      <SegmentBookmarkButton segment={segment} menu onDone={onClose} />
      <MenuButton
        disabled={false}
        icon={<Pencil size={13} aria-hidden="true" />}
        label="添加批注"
        description="设置类型、重要性，写下批注说明"
        onClick={() => {
          onOpenSegmentAnnotation(segment);
          onClose();
        }}
      />
      {pins ? <MenuButton disabled={false} icon={<Pin size={13} aria-hidden="true" />}
        label={pins.has(segment.uid) ? '查看固钉' : '固定'}
        description="固定在阅读区，滚动其他页面时继续对照"
        onClick={() => { pins.pin(segment); onClose(); }} /> : null}
      {onOpenSegmentWorkspace ? (
        <>
          <div className="my-1 border-t" />
          <MenuButton
            disabled={false}
            icon={<PanelRightOpen size={13} aria-hidden="true" />}
            label="在另一分栏查看片段记录"
            description="打开记录页，定位到此处的笔记"
            onClick={() => {
              onOpenSegmentWorkspace(segment);
              onClose();
            }}
          />
          <div className="my-1 border-t" />
        </>
      ) : null}
      {onHideSegment && !isListItem ? (
        <MenuButton
          disabled={false}
          icon={<EyeOff size={13} aria-hidden="true" />}
          label="在重排视图中隐藏此内容"
          description="仅调整重排显示，保留原始 PDF"
          onClick={() => {
            onHideSegment(segment);
            onClose();
          }}
        />
      ) : null}
      <MenuButton
        disabled={!onAddAssistantContext}
        icon={<MessageSquarePlus size={13} aria-hidden="true" />}
        label="附到助手对话"
        description={onAddAssistantContext ? '插入正在编辑的问题，保留原文引用，发送前可移除' : '当前阅读视图未连接助手'}
        onClick={() => {
          onAddAssistantContext?.(segment);
          onClose();
        }}
      />
      {wholeListSegment && onAddAssistantContext ? (
        <MenuButton disabled={false} icon={<MessageSquarePlus size={13} aria-hidden="true" />}
          label="添加整个列表到助手" description="包含当前列表中的所有条目"
          onClick={() => { onAddAssistantContext(wholeListSegment); onClose(); }} />
      ) : null}
      {translationActions ?? (onTranslateSegment ? (
        <MenuButton
          disabled={false}
          icon={<Languages size={13} aria-hidden="true" />}
          label="翻译此处内容"
          description="使用翻译模型生成此处的中文译文"
          onClick={() => {
            onTranslateSegment(segment);
            onClose();
          }}
        />
      ) : null)}
      {!isListItem && displayActions}
      <div className="my-1 border-t" />
      <MenuButton
        disabled={!canCopyContent || !onCopyContent}
        icon={<ClipboardCopy size={13} aria-hidden="true" />}
        label="复制原文内容"
        description={canCopyContent && onCopyContent ? '复制此处的文字，不附带论文来源' : '当前内容暂不可复制'}
        onClick={() => {
          onCopyContent?.(segment);
          onClose();
        }}
      />
      <MenuButton
        disabled={!canCopySourceLink || !onCopySourceLink}
        icon={<Link2 size={13} aria-hidden="true" />}
        label="复制原文引用"
        description={canCopySourceLink && onCopySourceLink ? '含摘录、论文名和页码，粘贴到笔记可回原文' : '当前内容暂不可复制引用'}
        onClick={() => {
          onCopySourceLink?.(segment);
          onClose();
        }}
      />
      {onInsertSegmentImage ? (
        <MenuButton
          disabled={!canInsertSegmentImage || !segment.asset_path}
          icon={<ImagePlus size={13} aria-hidden="true" />}
          label="将此处图片插入笔记"
          description={!segment.asset_path ? '此内容没有可插入的图片' : !canInsertSegmentImage ? '请先在另一分栏打开可编辑的笔记' : '插入到当前分屏打开的文档笔记'}
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
          label="将此处引用插入笔记"
          description="插入到当前分屏笔记，点击引用可回原文"
          onClick={() => {
            onAddSourceLink(segment);
            onClose();
          }}
        />
      ) : null}
      <div className="mt-1 border-t px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
        给部分文字高亮：先拖选文字，再点“仅高亮”。
      </div>
      </>}
    </div>
    </ViewportOverlay>,
    document.body,
  );
}
