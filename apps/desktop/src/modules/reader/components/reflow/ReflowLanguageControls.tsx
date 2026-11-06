import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ReflowOriginalDisplay } from '@/shared/lib/readerPreferences';

/** Language visibility stays independent of the amount of paragraph content. */
export function ReflowLanguageControls({ original, translation, onOriginalChange, onTranslationChange }: {
  original: ReflowOriginalDisplay;
  translation: boolean;
  onOriginalChange: (value: ReflowOriginalDisplay) => void;
  onTranslationChange: (value: boolean) => void;
}) {
  return <div role="group" aria-label="语言显示" className="reflow-toolbar-translation flex min-w-0 shrink-0 flex-wrap items-center gap-2">
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">源语言</span>
      <Select value={original} onValueChange={value => onOriginalChange(value as ReflowOriginalDisplay)}>
        <Tooltip><TooltipTrigger asChild><span className="inline-flex">
          <SelectTrigger className="w-[88px]" size="sm" aria-label="源语言显示"><SelectValue /></SelectTrigger>
        </span></TooltipTrigger><TooltipContent>控制文档原始语言的显示方式；逐句模式与段落详略互斥。</TooltipContent></Tooltip>
        <SelectContent>
          <SelectItem value="original">整段</SelectItem>
          <SelectItem value="sentences">逐句</SelectItem>
          <SelectItem value="hidden">隐藏</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-foreground">
      <Switch aria-label="显示中文译文" checked={translation} onCheckedChange={onTranslationChange} />
      <span>中文译文</span>
    </label>
  </div>;
}
