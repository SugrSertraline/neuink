import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { COMPACTION_TRIGGER_RATIO, CONTEXT_WARNING_RATIO } from '../sdk/contextBudget';

/**
 * Context usage next to the composer; clicking it compacts the conversation. The arc is the state
 * signal and the tooltip carries the numbers, so the meaning never rests on colour alone.
 * `disabledReason` is the single reason the action is unavailable — a run in this conversation, or
 * no history yet. A disabled button still receives pointer events in the browser, but its tooltip
 * must not be the only place the reason exists, so the accessible name carries it too.
 */
export function AssistantContextRing({
  compacting,
  disabledReason,
  kiloTokens,
  modelKiloTokens,
  onCompact,
  usageRatio
}: {
  compacting: boolean;
  disabledReason: string | null;
  kiloTokens: number;
  modelKiloTokens: number;
  onCompact: () => void;
  usageRatio: number;
}) {
  const percent = Math.round(usageRatio * 100);
  const summary = `上下文约 ${kiloTokens}k / ${modelKiloTokens}k tokens（${percent}%）`;
  const tone = usageRatio >= COMPACTION_TRIGGER_RATIO
    ? 'text-destructive'
    : usageRatio >= CONTEXT_WARNING_RATIO
      ? 'text-warning'
      : 'text-muted-foreground';
  const label = compacting
    ? '正在压缩全部当前上下文'
    : `${summary}，${disabledReason ?? '点击压缩全部当前上下文'}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          size="icon-sm"
          type="button"
          variant="ghost"
          className={tone}
          disabled={compacting || Boolean(disabledReason)}
          onClick={onCompact}
        >
          {compacting
            ? <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={15} />
            : <ProgressRing className="size-5" size={20} strokeWidth={2.5} value={usageRatio} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {compacting
          ? '正在压缩全部当前上下文…'
          : disabledReason ?? `${summary} · ${usageRatio >= COMPACTION_TRIGGER_RATIO ? '自动压缩将保留最近消息；点击可压缩全部当前上下文' : '点击压缩全部当前上下文'}`}
      </TooltipContent>
    </Tooltip>
  );
}
