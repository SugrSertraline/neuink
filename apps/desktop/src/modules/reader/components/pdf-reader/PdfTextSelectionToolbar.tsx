import {
  Check,
  Loader2,
  Send,
  Star
} from 'lucide-react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { ReadingSelectionToolbarControls } from './ReadingSelectionToolbarControls';
import { ReadingSelectionToolbarContext } from './readingSelectionToolbarContext';
import { useSelectionToolbarPosition } from './useSelectionToolbarPosition';
import { SelectionTranslationPanel } from './SelectionTranslationPanel';
import type { ApplyTextSelectionAnnotation } from './textSelectionAnnotation';
export { calculateFloatingToolbarLayout } from './selectionToolbarLayout';

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

export type PdfTextSelectionToolbarProps = {
  autoTranslate?: boolean;
  visible?: boolean;
  pending: PendingPdfTextSelection | null;
  onApply?: ApplyTextSelectionAnnotation;
  onClose: () => void;
  onTranslate?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onAsk?: (input: { segment: SourceSegment; text: string }, intent: 'ask' | 'explain') => void;
};

export function PdfTextSelectionToolbar(props: PdfTextSelectionToolbarProps) {
  const host = useContext(ReadingSelectionToolbarContext);
  const owner = useId();
  useEffect(() => { host?.publish(owner, props); }, [host, owner, props.pending, props.visible, props.autoTranslate, props.onApply, props.onClose, props.onTranslate, props.onAsk]);
  useEffect(() => () => host?.release(owner), [host, owner]);
  return host ? null : <PdfTextSelectionToolbarContent {...props} />;
}

export function PdfTextSelectionToolbarContent({
  autoTranslate = false,
  visible = true,
  pending: incomingPending,
  onApply,
  onClose,
  onTranslate,
  onAsk
}: PdfTextSelectionToolbarProps) {
  const { notify } = useToast();
  const [panel, setPanel] = useState<ExpandedPanel>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveRequestRef = useRef<symbol | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [color, setColor] = useState<AnnotationHighlightColor>('yellow');
  const [importance, setImportance] = useState<AnnotationImportance>('normal');
  const translationRequestRef = useRef(0);
  const autoTranslatedSelectionKeyRef = useRef('');
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const retained = useRef<PendingPdfTextSelection | null>(null);
  if (incomingPending) retained.current = incomingPending;
  const position = useSelectionToolbarPosition(toolbarRef, incomingPending ?? retained.current, visible, `${panel}:${translating}:${translation}`);
  const pending = incomingPending ?? (position.pinned ? retained.current : null);
  const { layout } = position;
  useReaderSelectionPriority(Boolean(pending) && visible);
  const close = () => {
    position.reset();
    retained.current = null;
    translationRequestRef.current += 1;
    saveRequestRef.current = null;
    setSaving(false);
    onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!pending || !visible) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    // Native text selection leaves focus in the reader, not in this portal.
    // The toolbar also owns Escape while pinned and waiting for a new selection.
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [Boolean(pending), visible]);
  useEffect(() => {
    const dismiss = () => closeRef.current();
    window.addEventListener('neuink:reader-surface-change', dismiss);
    return () => {
      translationRequestRef.current += 1;
      saveRequestRef.current = null;
      window.removeEventListener('neuink:reader-surface-change', dismiss);
    };
  }, []);
  const selectionKey = pending
    ? JSON.stringify([pending.segment.uid, pending.selection.page_idx, pending.selection.text, pending.selection.rects])
    : '';
  const selectionKeyRef = useRef(selectionKey);
  selectionKeyRef.current = selectionKey;

  useEffect(() => {
    translationRequestRef.current += 1;
    setPanel(current => position.pinned ? current : null);
    setComment('');
    setTranslation(null);
    setTranslationError(null);
    setTranslating(false);
    setSaving(false);
    setSaveError(null);
    saveRequestRef.current = null;
    setColor('yellow');
    setImportance('normal');
    if (!selectionKey) {
      autoTranslatedSelectionKeyRef.current = '';
    }
  }, [selectionKey]);

  useEffect(() => {
    if (
      !autoTranslate ||
      !incomingPending ||
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
    void onTranslate({ segment: incomingPending.segment, text: incomingPending.selection.text })
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

  if (!pending || !visible || typeof document === 'undefined') {
    return null;
  }

  // Translation is intentionally non-blocking: highlighting, annotation and copy
  // remain available while the selected text is being translated.
  const busy = saving || !incomingPending;
  const apply = async (content: string, contentMode?: 'append') => {
    if (!onApply || !incomingPending || saveRequestRef.current) return;
    const applyingSelection = selectionKey;
    const request = Symbol();
    saveRequestRef.current = request;
    const isCurrent = () => saveRequestRef.current === request && selectionKeyRef.current === applyingSelection;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await onApply({
        content: content.trim(),
        ...(contentMode ? { contentMode } : {}),
        importance,
        segment: pending.segment,
        selection: { ...pending.selection, color }
      });
      if (!isCurrent()) return;
      if (saved === false) {
        setSaveError('批注保存失败，请重试。');
        return;
      }
      if (position.pinned) {
        setPanel(null);
        setComment('');
        onClose();
      } else close();
    } catch {
      if (isCurrent()) setSaveError('批注保存失败，请重试。');
    } finally {
      if (isCurrent()) {
        saveRequestRef.current = null;
        setSaving(false);
      }
    }
  };
  const translate = async () => {
    if (!onTranslate || !incomingPending || translating) {
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
      data-pinned={position.pinned ? 'true' : 'false'}
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
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}
    >
      <ReadingSelectionToolbarControls text={pending.selection.text} saving={saving} translating={translating}
        translationFailed={Boolean(translationError)} panel={panel} onClose={close}
        pinned={position.pinned} onTogglePin={position.toggle} dragHandleProps={position.handleProps}
        selectionAvailable={Boolean(incomingPending)}
        onTranslate={onTranslate ? () => void translate() : undefined}
        onAsk={onAsk ? intent => { if (incomingPending) onAsk({ segment:incomingPending.segment, text:incomingPending.selection.text }, intent); } : undefined}
        onHighlight={onApply ? () => void apply('') : undefined}
        onAnnotate={onApply ? () => { if (incomingPending) setPanel(current => current === 'annotation' ? null : 'annotation'); } : undefined}
        onCopy={() => void copy(pending.selection.text.replace(/\n+/g, ' '), '选中文字已复制')} />

      {position.pinned && !incomingPending ? <p className="mt-2 text-xs text-muted-foreground">已固定，选择其他文字可更新内容。</p> : null}

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
        <SelectionTranslationPanel translation={translation} error={translationError} translating={translating}
          saving={saving} disabled={busy} onCopy={text => void copy(text, '译文已复制')}
          onAnnotate={onApply ? text => void apply(text, 'append') : undefined} />
      ) : null}

      {saveError ? <p role="alert" className="mt-2 text-xs text-destructive">{saveError}</p> : null}

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
