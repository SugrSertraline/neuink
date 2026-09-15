import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EntryContentHeader } from '../EntryContentHeader';

export function ReflowToolbar({ compact, entryTitle, appearance, translationMode, busy, children }: {
  compact: boolean; entryTitle: string; appearance: ReactNode; translationMode: ReactNode; busy: boolean; children: ReactNode;
}) {
  if (!compact) return <EntryContentHeader className="gap-2" contentTitle="重排视图" entryTitle={entryTitle}>
    <span className="min-w-0 flex-1" />{appearance}{children}{translationMode}
  </EntryContentHeader>;
  return <div aria-label="重排阅读工具" data-reader-compact-toolbar className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-b bg-background px-2 py-0.5">
    {appearance}
    <div className="min-w-0 flex-1" />
    {translationMode}
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant={busy ? 'secondary' : 'outline'} aria-label="重排阅读工具菜单" title="内容显示、悬停预览、翻译与导出">{busy ? '翻译中' : '阅读工具'}</Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-72 max-w-[calc(100vw-2rem)] space-y-3">
        <p className="text-xs font-medium">内容显示、翻译与导出</p>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </PopoverContent>
    </Popover>
  </div>;
}
