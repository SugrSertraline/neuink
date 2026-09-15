import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

// Both library layouts keep long titles to one line; opening the entry exposes its full details.
export function LibraryEntryTitle({ entry }: { entry: Pick<LibraryEntry, 'title' | 'fields' | 'pdfFileName'> }) {
  const summary = entry.fields.description || entry.pdfFileName || '无 PDF 文件';
  return <div className="w-full min-w-0 max-w-full py-0.5 text-left">
    <div className="truncate text-[13px] font-medium leading-5" title={entry.title}>{entry.title}</div>
    <div className="truncate text-xs leading-4 text-muted-foreground" title={summary}>{summary}</div>
  </div>;
}
