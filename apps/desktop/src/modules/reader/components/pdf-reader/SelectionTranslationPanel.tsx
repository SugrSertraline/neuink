import { ClipboardCopy, Loader2, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SelectionTranslationPanel({ translation, error, translating, saving, disabled, onCopy, onAnnotate }: {
  translation: string | null;
  error: string | null;
  translating: boolean;
  saving: boolean;
  disabled: boolean;
  onCopy: (text: string) => void;
  onAnnotate?: (text: string) => void;
}) {
  const hasTranslation = Boolean(translation?.trim()) && !translating && !error;
  return <div className="mt-2 grid gap-2 border-t pt-2">
    <div className="text-[11px] font-semibold text-muted-foreground">选中文字翻译</div>
    {error ? <p role="alert" className="text-xs text-destructive">{error}，可点击“重试翻译”。</p> : null}
    <div className="max-h-36 overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-sm leading-6">
      {translating ? <span className="inline-flex items-center gap-2 text-muted-foreground">
        <Loader2 className="animate-spin" size={14} aria-hidden="true" />正在翻译选中文字…
      </span> : translation?.trim() ? translation : '暂无译文'}
    </div>
    {hasTranslation ? <div className="flex flex-wrap justify-end gap-1.5">
      <Button size="sm" variant="outline" type="button" onClick={() => onCopy(translation!)}>
        <ClipboardCopy size={13} aria-hidden="true" />复制译文
      </Button>
      {onAnnotate ? <Button size="sm" type="button" disabled={disabled || saving}
        onClick={() => onAnnotate(translation!)}>
        {saving ? <Loader2 className="animate-spin" size={13} aria-hidden="true" /> : <MessageSquareText size={13} aria-hidden="true" />}
        {saving ? '保存中…' : '添加到高亮批注'}
      </Button> : null}
    </div> : null}
  </div>;
}
