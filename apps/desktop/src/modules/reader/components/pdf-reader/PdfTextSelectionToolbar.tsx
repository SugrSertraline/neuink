import {
  Check,
  ClipboardCopy,
  Highlighter,
  Info,
  Languages,
  Loader2,
  MessageSquareText,
  Send,
  Star,
  X
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { useReaderSelectionPriority } from '@/components/ui/hover-interactions';

import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import type {
  AnnotationHighlightColor,
  AnnotationImportance,
  AnnotationTextSelection,
  SourceSegment
} from '@/shared/types/domain';

import { describeTranslationFailure } from '../../translation/translationErrorMessage';

const HIGHLIGHT_COLORS: Array<{
  color: AnnotationHighlightColor;
  label: string;
  swatchClassName: string;
}> = [
  { color: 'yellow', label: '黄色', swatchClassName: 'bg-amber-300' },
  { color: 'green', label: '绿色', swatchClassName: 'bg-emerald-300' },
  { color: 'blue', label: '蓝色', swatchClassName: 'bg-sky-300' },
  { color: 'pink', label: '粉色', swatchClassName: 'bg-pink-300' }
];

type ExpandedPanel = 'annotation' | 'translation' | null;

export type PendingPdfTextSelection = {
  anchorRect?: { bottom: number; left: number; right: number; top: number };
  position: { x: number; y: number };
  segment: SourceSegment;
  selection: Omit<AnnotationTextSelection, 'color'>;
};

export function PdfTextSelectionToolbar({
  autoTranslate = false,
  visible = true,
  pending,
  onApply,
  onClose,
  onTranslate,
  onAsk
}: {
  autoTranslate?: boolean;
  visible?: boolean;
  pending: PendingPdfTextSelection | null;
  onApply?: (input: {
    content: string;
    importance: AnnotationImportance;
    segment: SourceSegment;
    selection: AnnotationTextSelection;
  }) => Promise<void> | void;
  onClose: () => void;
  onTranslate?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onAsk?: (input: { segment: SourceSegment; text: string }, intent: 'ask' | 'explain') => void;
}) {
  const { notify } = useToast();
  useReaderSelectionPriority(Boolean(pending) && visible);
  const [panel, setPanel] = useState<ExpandedPanel>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [color, setColor] = useState<AnnotationHighlightColor>('yellow');
  const [importance, setImportance] = useState<AnnotationImportance>('normal');
  const translationRequestRef = useRef(0);
  const autoTranslatedSelectionKeyRef = useRef('');
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<FloatingToolbarLayout | null>(null);
  const selectionKey = pending
    ? `${pending.segment.uid}:${pending.selection.page_idx}:${pending.selection.text}`
    : '';

  useEffect(() => {
    translationRequestRef.current += 1;
    setPanel(null);
    setComment('');
    setTranslation(null);
    setTranslationError(null);
    setTranslating(false);
    setSaving(false);
    setColor('yellow');
    setImportance('normal');
    setLayout(null);
    if (!selectionKey) {
      autoTranslatedSelectionKeyRef.current = '';
    }
  }, [selectionKey]);

  useEffect(() => {
    if (
      !autoTranslate ||
      !pending ||
      !onTranslate ||
      !selectionKey ||
      autoTranslatedSelectionKeyRef.current === selectionKey
    ) {
      return;
    }

    autoTranslatedSelectionKeyRef.current = selectionKey;
    const requestId = ++translationRequestRef.current;
    setPanel('translation');
    setTranslation(null);
    setTranslationError(null);
    setTranslating(true);
    void onTranslate({ segment: pending.segment, text: pending.selection.text })
      .then((translatedText) => {
        if (translationRequestRef.current === requestId) {
          setTranslation(translatedText);
        }
      })
      .catch((caught) => {
        if (translationRequestRef.current === requestId) {
          setTranslationError(describeTranslationFailure(caught));
        }
      })
      .finally(() => {
        if (translationRequestRef.current === requestId) {
          setTranslating(false);
        }
      });
  }, [autoTranslate, notify, onTranslate, pending, selectionKey]);

  useLayoutEffect(() => {
    if (!pending || !visible || typeof window === 'undefined') {
      return;
    }

    let frame = 0;
    const toolbar = toolbarRef.current;
    const updateLayout = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const element = toolbarRef.current;
        if (!element) {
          return;
        }
        const viewport = window.visualViewport;
        const bounds = element.getBoundingClientRect();
        const cssScale = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
        setLayout(
          calculateFloatingToolbarLayout({
            anchor:
              pending.anchorRect ?? {
                bottom: pending.position.y,
                left: pending.position.x,
                right: pending.position.x,
                top: pending.position.y
              },
            contentHeight: element.scrollHeight * cssScale,
            contentWidth: bounds.width,
            cssScale,
            viewport: {
              height: viewport?.height ?? window.innerHeight,
              left: viewport?.offsetLeft ?? 0,
              top: viewport?.offsetTop ?? 0,
              width: viewport?.width ?? window.innerWidth
            }
          })
        );
      });
    };

    const resizeObserver = toolbar && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateLayout)
      : null;
    if (toolbar) {
      resizeObserver?.observe(toolbar);
    }
    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.visualViewport?.addEventListener('resize', updateLayout);
    window.visualViewport?.addEventListener('scroll', updateLayout);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateLayout);
      window.visualViewport?.removeEventListener('resize', updateLayout);
      window.visualViewport?.removeEventListener('scroll', updateLayout);
    };
  }, [panel, pending, selectionKey, translating, translation, visible]);

  if (!pending || !visible || typeof document === 'undefined') {
    return null;
  }

  // Translation is intentionally non-blocking: highlighting, annotation and copy
  // remain available while the selected text is being translated.
  const busy = saving;
  const apply = async (content: string) => {
    if (!onApply) return;
    setSaving(true);
    try {
      await onApply({
        content: content.trim(),
        importance,
        segment: pending.segment,
        selection: { ...pending.selection, color }
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  const translate = async () => {
    if (!onTranslate || translating) {
      return;
    }
    setPanel('translation');
    if (translation !== null) return;
    const requestId = ++translationRequestRef.current;
    setTranslationError(null);
    setTranslation(null);
    setTranslating(true);
    try {
      const translatedText = await onTranslate({
        segment: pending.segment,
        text: pending.selection.text
      });
      if (translationRequestRef.current === requestId) {
        setTranslation(translatedText);
      }
    } catch (caught) {
      if (translationRequestRef.current === requestId) {
        setTranslationError(describeTranslationFailure(caught));
      }
    } finally {
      if (translationRequestRef.current === requestId) {
        setTranslating(false);
      }
    }
  };
  const copy = async (text: string, title: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify({ tone: 'success', title });
    } catch {
      notify({ tone: 'danger', title: '复制失败', description: '无法访问系统剪贴板。' });
    }
  };

  return createPortal(
    <div
      ref={toolbarRef}
      data-material="reader-popover"
      data-reading-selection-toolbar
      className="fixed z-[var(--z-reader-selection)] w-[min(23rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-lg border bg-popover p-2 shadow-xl"
      data-placement={layout?.placement}
      role="dialog"
      aria-label="选区操作"
      style={{
        left: layout?.left ?? pending.position.x,
        maxHeight: layout?.maxHeight ?? 'calc(100vh - 1rem)',
        maxWidth: layout?.maxWidth,
        opacity: layout ? 1 : 0,
        pointerEvents: layout ? 'auto' : 'none',
        top: layout?.top ?? pending.position.y,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <Highlighter size={14} aria-hidden="true" />
          <span className="truncate">已选 {pending.selection.text.length} 个字符</span>
        </div>
        <Button size="icon-xs" variant="ghost"
          title="关闭选区工具"
          type="button"
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
        <ActionButton
          disabled={saving || translating || !onTranslate}
          icon={translating ? <Loader2 className="animate-spin" size={13} /> : <Languages size={13} />}
          label={translationError ? '重试翻译' : '翻译'}
          selected={panel === 'translation'}
          onClick={() => void translate()}
        />
        {onAsk ? <>
          <ActionButton disabled={busy} icon={<MessageSquareText size={13} />} label="提问"
            onClick={() => onAsk({ segment: pending.segment, text: pending.selection.text }, 'ask')} />
          <ActionButton disabled={busy} icon={<Info size={13} />} label="解释"
            onClick={() => onAsk({ segment: pending.segment, text: pending.selection.text }, 'explain')} />
        </> : null}
        {onApply ? <><ActionButton
          disabled={busy}
          icon={<Highlighter size={13} />}
          label="仅高亮"
          onClick={() => void apply('')}
        />
        <ActionButton
          disabled={busy}
          icon={<MessageSquareText size={13} />}
          label="高亮并批注"
          selected={panel === 'annotation'}
          onClick={() => setPanel((current) => current === 'annotation' ? null : 'annotation')}
        /></> : null}
        <button
          aria-label="复制选中文字"
          className="grid size-8 place-items-center rounded border hover:bg-muted disabled:opacity-50"
          disabled={busy}
          title="复制选中文字"
          type="button"
          onClick={() => void copy(pending.selection.text.replace(/\n+/g, ' '), '选中文字已复制')}
        >
          <ClipboardCopy size={14} aria-hidden="true" />
        </button>
      </div>

      {translating && panel !== 'translation' ? (
        <div className="mt-2 inline-flex w-full items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="animate-spin" size={13} aria-hidden="true" />
          正在翻译选中文字，其他操作仍可继续
        </div>
      ) : null}

      {onApply ? <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">高亮颜色</span>
        <div className="flex items-center gap-1.5" aria-label="高亮颜色">
          {HIGHLIGHT_COLORS.map((item) => (
            <button
              aria-label={`选择${item.label}高亮`}
              className={cn(
                'grid size-6 place-items-center rounded border transition hover:scale-105 disabled:opacity-50',
                item.swatchClassName,
                color === item.color && 'ring-2 ring-primary ring-offset-1'
              )}
              disabled={busy}
              key={item.color}
              title={`高亮：${item.label}`}
              type="button"
              onClick={() => setColor(item.color)}
            >
              {color === item.color ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </div> : null}

      {panel === 'translation' ? (
        <div className="mt-2 grid gap-2 border-t pt-2">
          <div className="text-[11px] font-semibold text-muted-foreground">快速翻译</div>
          {translationError ? <p role="alert" className="text-xs text-destructive">{translationError}，可点击“重试翻译”。</p> : null}
          <div className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm leading-6">
            {translating ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="animate-spin" size={14} />正在翻译选中文字…
              </span>
            ) : translation || '暂无译文'}
          </div>
          {translation ? (
            <div className="flex justify-end">
              <button
                className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs hover:bg-muted"
                type="button"
                onClick={() => void copy(translation, '译文已复制')}
              >
                <ClipboardCopy size={13} />复制译文
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {onApply && panel === 'annotation' ? (
        <div data-material="annotation-paper" data-paper-color={color} className="mt-2 grid gap-2 border-t pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">选区批注重要性</span>
            <div className="flex items-center gap-0.5" aria-label="重要性星级">
              {(['normal', 'important', 'core'] as AnnotationImportance[]).map((value, index) => (
                <button
                  aria-label={`设为${index + 1}星`}
                  className="rounded p-0.5 text-amber-500 disabled:opacity-50"
                  disabled={busy}
                  key={value}
                  title={`${index + 1} 星重要性`}
                  type="button"
                  onClick={() => setImportance(value)}
                >
                  <Star
                    fill={index <= ['normal', 'important', 'core'].indexOf(importance) ? 'currentColor' : 'none'}
                    size={16}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
          <textarea
            autoFocus
            className="min-h-20 w-full resize-y rounded border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            placeholder="写下针对这段选中文字的批注"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="flex justify-end gap-1.5">
            <button
              className="h-7 rounded px-2 text-xs text-muted-foreground hover:bg-muted"
              disabled={busy}
              type="button"
              onClick={() => {
                setComment('');
                setPanel(null);
              }}
            >
              取消
            </button>
            <button
              className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              disabled={busy || !comment.trim()}
              type="button"
              onClick={() => void apply(comment)}
            >
              {saving ? <Loader2 className="animate-spin" size={13} /> : <Send size={13} />}
              保存选区批注
            </button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  );
}

type FloatingToolbarLayout = {
  left: number;
  maxHeight: number;
  maxWidth: number;
  placement: 'above' | 'below';
  top: number;
};

export function calculateFloatingToolbarLayout({
  anchor,
  contentHeight,
  contentWidth,
  cssScale = 1,
  viewport
}: {
  anchor: { bottom: number; left: number; right: number; top: number };
  contentHeight: number;
  contentWidth: number;
  cssScale?: number;
  viewport: { height: number; left: number; top: number; width: number };
}): FloatingToolbarLayout {
  const margin = 8;
  const gap = 8;
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const width = Math.min(contentWidth, Math.max(0, viewport.width - margin * 2));
  const left = clamp(
    (anchor.left + anchor.right - width) / 2,
    viewport.left + margin,
    Math.max(viewport.left + margin, viewportRight - margin - width)
  );
  const availableBelow = Math.max(0, viewportBottom - margin - anchor.bottom - gap);
  const availableAbove = Math.max(0, anchor.top - gap - (viewport.top + margin));
  const placement: FloatingToolbarLayout['placement'] =
    contentHeight <= availableBelow || (availableBelow >= availableAbove && contentHeight > availableAbove)
      ? 'below'
      : 'above';
  const availableHeight = placement === 'below' ? availableBelow : availableAbove;
  const maxHeight = Math.max(0, availableHeight);
  const visibleHeight = Math.min(contentHeight, maxHeight);
  const idealTop = placement === 'below'
    ? anchor.bottom + gap
    : anchor.top - gap - visibleHeight;
  const top = clamp(
    idealTop,
    viewport.top + margin,
    Math.max(viewport.top + margin, viewportBottom - margin - visibleHeight)
  );

  // DOM rectangles are viewport pixels; fixed offsets inherit the app's CSS zoom.
  const scale = Number.isFinite(cssScale) && cssScale > 0 ? cssScale : 1;
  return { left: left / scale, maxHeight: maxHeight / scale,
    maxWidth: Math.max(0, viewport.width - margin * 2) / scale, placement, top: top / scale };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function ActionButton({
  disabled,
  icon,
  label,
  onClick,
  selected = false
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <Button variant="outline" size="sm"
      aria-pressed={selected}
      className={cn(
        selected && 'border-primary/40 bg-primary/10 text-primary'
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}
