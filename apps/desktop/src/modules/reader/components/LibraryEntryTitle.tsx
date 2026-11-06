import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Keep the row compact while exposing the complete title without opening the entry.
export function LibraryEntryTitle({ entry }: { entry: Pick<LibraryEntry, 'title' | 'fields' | 'pdfFileName'> }) {
  const summary = entry.fields.description || entry.pdfFileName || '无 PDF 文件';
  return <div className="w-full min-w-0 max-w-full py-0.5 text-left">
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="truncate rounded-sm text-[13px] font-medium leading-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{entry.title}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-[min(36rem,var(--radix-tooltip-content-available-width))] whitespace-normal leading-5">
        <span className="min-w-0 [overflow-wrap:anywhere]">{entry.title}</span>
      </TooltipContent>
    </Tooltip>
    <div className="truncate text-xs leading-4 text-muted-foreground" title={summary}>{summary}</div>
  </div>;
}
