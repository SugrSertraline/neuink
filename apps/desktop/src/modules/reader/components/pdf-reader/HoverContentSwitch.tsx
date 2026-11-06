import { useId } from 'react';
import { Switch } from '@/components/ui/switch';

/** One compound control with independent, accessible visibility and mode switches.
 * The mode lives inside the shared track, never inside another interactive element.
 */
export function HoverContentSwitch({ label, checked, disabled, sentence, onVisibilityChange, onSentenceChange }: {
  label: string; checked: boolean; disabled: boolean; sentence: boolean;
  onVisibilityChange: (checked: boolean) => void; onSentenceChange?: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  const content = label === '译文' ? '译文' : '原文';
  const mode = sentence && onSentenceChange ? '逐句' : '整段';
  const status = disabled ? `悬停已暂停 · ${checked ? `保留${mode}${content}` : `${content}已关闭`}`
    : checked ? `显示${mode}${content}` : `${content}已关闭`;
  return <section aria-label={`${label}悬停设置`} className="my-3 px-1">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div role="group" aria-label={`${label}复合开关`} aria-describedby={descriptionId}
        className={`inline-flex items-center gap-2 rounded-full border p-1 pl-1.5 transition-colors motion-reduce:transition-none ${checked && !disabled ? 'border-primary/25 bg-primary/10' : 'border-border bg-muted/40'}`}>
        {onSentenceChange ? <button type="button" role="switch" aria-label={`${label}逐句显示`}
          aria-checked={sentence} aria-describedby={descriptionId} disabled={disabled || !checked}
          onClick={() => onSentenceChange(!sentence)}
          className="relative grid h-7 w-24 grid-cols-2 items-center rounded-full text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40">
          <span aria-hidden="true" className={`absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none ${sentence ? 'translate-x-full' : ''}`} />
          <span className={`relative z-10 ${sentence ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>整段</span>
          <span className={`relative z-10 ${sentence ? 'font-medium text-primary' : 'text-muted-foreground'}`}>逐句</span>
        </button> : <span className="px-2 text-xs text-muted-foreground">整段</span>}
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <Switch className="mr-1" aria-label={label} aria-describedby={descriptionId}
          checked={checked} disabled={disabled} onCheckedChange={onVisibilityChange} />
      </div>
    </div>
    <p id={descriptionId} role="status" className="mt-2 text-xs text-muted-foreground">{status}</p>
    {checked && !disabled && sentence && onSentenceChange ? <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">无法定位对应句时，显示整段{content}并提示。</p> : null}
  </section>;
}
