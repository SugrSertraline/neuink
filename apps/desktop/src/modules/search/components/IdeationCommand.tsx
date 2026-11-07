import { Lightbulb } from 'lucide-react';
import { CommandGroup, CommandItem, CommandList } from '@/components/ui/command';

export function isIdeationCommand(query: string) {
  return query.trim().toLowerCase() === '/inspiration';
}

/** Deliberate opt-in to the experimental workspace; ordinary searches never expose it. */
export function IdeationCommand({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  return <CommandList className="p-2">
    <CommandGroup heading="实验功能">
      <CommandItem value="open-ideation" disabled={!enabled} onSelect={() => { if (enabled) onOpen(); }} className="gap-3 px-3 py-2.5">
        <Lightbulb aria-hidden="true" />
        <span className="flex min-w-0 flex-col gap-1">
          <span>打开研究构思</span>
          <span className="text-xs text-muted-foreground">{enabled ? '使用论文卡片整理背景、问题与方法；不会自动生成内容' : '请先打开资料库并等待加载完成'}</span>
        </span>
      </CommandItem>
    </CommandGroup>
  </CommandList>;
}
