import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { LibraryEntry, LibraryEntryStatus } from '../../library/components/LibrarySidebar';
import { EntryTagBadges } from './EntryTagBadges';

export function AssetSummary({ entry, compact = false }: { entry: LibraryEntry; compact?: boolean }) {
  const notes = entry.contents.filter((content) => content.kind === 'note').length;
  if (compact) return <div className="truncate text-xs text-muted-foreground" title={`${entry.pdfFileName || '无 PDF'} · ${notes} 篇笔记`}>
    <span className={cn(entry.pdfFileName && 'text-foreground')}>{entry.pdfFileName ? 'PDF' : '无 PDF'}</span>
    {notes > 0 ? <span> · {notes} 篇笔记</span> : null}
  </div>;
  return (
    <div className="flex flex-wrap gap-1">
      {entry.pdfFileName ? <Badge variant="secondary">PDF</Badge> : <Badge variant="outline">无 PDF</Badge>}
      <Badge variant={notes > 0 ? 'secondary' : 'outline'}>{notes} 篇笔记</Badge>
    </div>
  );
}

export function FieldBadges({ fields }: { fields: Record<string, string> }) {
  const pairs = Object.entries(fields);
  if (pairs.length === 0) {
    return <Badge variant="outline">无字段</Badge>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {pairs.slice(0, 4).map(([key, value]) => (
        <Badge key={key} variant="outline">
          {key}: {value}
        </Badge>
      ))}
      {pairs.length > 4 ? <Badge variant="secondary">+{pairs.length - 4}</Badge> : null}
    </div>
  );
}

export function TagBadges({ tags, compact = false }: { tags: string[]; compact?: boolean }) {
  return <EntryTagBadges tags={tags} compact={compact} />;
}

export function StatusBadge({ status }: { status: LibraryEntryStatus }) {
  if (status === 'Parsed') {
    return <Badge className="bg-success text-white">已解析</Badge>;
  }
  if (status === 'Failed') {
    return <Badge variant="destructive">失败</Badge>;
  }
  if (status === 'Canceled') {
    return <Badge variant="outline">已取消</Badge>;
  }
  if (status === 'No PDF') {
    return <Badge variant="outline">无 PDF</Badge>;
  }
  const label = status === 'Queued' ? '排队中' : status === 'Uploading' ? '上传中' : '解析中';
  return <Badge className="bg-blue-100 text-blue-700 ring-1 ring-blue-200">{label}</Badge>;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('zh-CN');
}
