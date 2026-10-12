import { ClipboardCopy, Highlighter, Info, Languages, Loader2, MessageSquareText, Pin, X } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Presentation only. The reader owns requests and edits; tutorials provide no action handlers. */
export function ReadingSelectionToolbarControls({
  text, demonstration = false, saving = false, translating = false, translationFailed = false,
  panel = null, onClose, onTranslate, onAsk, onHighlight, onAnnotate, onCopy,
  pinned = false, onTogglePin, dragHandleProps, selectionAvailable = true
}: {
  text: string;
  demonstration?: boolean;
  saving?: boolean;
  translating?: boolean;
  translationFailed?: boolean;
  panel?: 'annotation' | 'translation' | null;
  onClose?: () => void;
  onTranslate?: () => void;
  onAsk?: (intent: 'ask' | 'explain') => void;
  onHighlight?: () => void;
  onAnnotate?: () => void;
  onCopy?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  selectionAvailable?: boolean;
}) {
  const busy = demonstration || saving;
  const actionBusy = busy || !selectionAvailable;
  const actions = [
    { label: translationFailed ? '重试翻译' : '翻译', icon: translating ? Loader2 : Languages,
      selected: panel === 'translation', disabled: actionBusy || translating || !onTranslate, onClick: onTranslate },
    ...(demonstration || onAsk ? [
      { label: '提问', icon: MessageSquareText, disabled: actionBusy, onClick: () => onAsk?.('ask') },
      { label: '解释', icon: Info, disabled: actionBusy, onClick: () => onAsk?.('explain') }
    ] : []),
    ...(demonstration || onHighlight ? [
      { label: '仅高亮', icon: Highlighter, disabled: actionBusy, onClick: onHighlight }
    ] : []),
    ...(demonstration || onAnnotate ? [
      { label: '高亮并批注', icon: MessageSquareText, selected: panel === 'annotation', disabled: actionBusy, onClick: onAnnotate }
    ] : [])
  ];
  return <>
    <div className="flex items-center gap-2">
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
        <Highlighter size={14} aria-hidden="true" />
        <span className="truncate">已选 {text.length} 个字符</span>
      </div>
      {pinned && !demonstration ? <Button size="xs" variant="ghost" type="button"
        className="min-w-10 flex-1 touch-none cursor-grab px-2 active:cursor-grabbing"
        aria-label="拖动选区工具，方向键调整位置" title="拖动或用方向键调整位置" {...dragHandleProps}>
        <span aria-hidden="true" className="h-1 w-16 max-w-full rounded-full bg-muted-foreground/40" />
      </Button> : <span className="flex-1" />}
      {demonstration ? <span className="shrink-0 text-[11px] text-muted-foreground">演示 · 不执行操作</span>
        : <div className="flex shrink-0 items-center gap-1">
          {onTogglePin && <Button size="xs" variant="ghost" aria-pressed={pinned} onClick={onTogglePin}>
            <Pin size={13} aria-hidden="true" />{pinned ? '取消固定' : '固定'}
          </Button>}
          <Button size="icon-xs" variant="ghost" aria-label="关闭选区工具" title="关闭选区工具" type="button" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </Button></div>}
    </div>
    {demonstration ? <p className="mt-2 line-clamp-2 break-words rounded bg-muted/50 px-2 py-1.5 text-xs leading-5 text-foreground">“{text}”</p> : null}
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
      {actions.map(({ label, icon: Icon, selected = false, disabled, onClick }) =>
        <Button key={label} variant="outline" size="sm" aria-pressed={selected}
          className={cn(selected && 'border-primary/40 bg-primary/10 text-primary', demonstration && 'disabled:opacity-100')}
          disabled={disabled} type="button" onClick={demonstration ? undefined : onClick}>
          <Icon size={13} aria-hidden="true" className={translating && Icon === Loader2 ? 'animate-spin' : undefined} />
          {label}
        </Button>)}
      <button aria-label="复制选中文字" title="复制选中文字" type="button" disabled={busy}
        className={cn('grid size-8 place-items-center rounded border hover:bg-muted disabled:opacity-50', demonstration && 'disabled:opacity-100')}
        onClick={demonstration ? undefined : onCopy}>
        <ClipboardCopy size={14} aria-hidden="true" />
      </button>
    </div>
  </>;
}
