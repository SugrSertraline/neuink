import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { AssistantReadingChoice, AssistantReadingContext } from './assistantReadingContext';

export function AssistantReadingContextControl({ context, entries, busy, choice, onChange }: {
  context: AssistantReadingContext; entries: LibraryEntry[]; busy: boolean;
  choice: AssistantReadingChoice; onChange: (choice: AssistantReadingChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const candidates = entries.flatMap(entry => [{ entryId: entry.id, noteId: undefined as string | undefined, label: entry.title, description: '论文' },
    ...entry.contents.flatMap(content => content.kind === 'note'
      ? [{ entryId: entry.id, noteId: content.note_id, label: content.title, description: entry.title }] : [])])
    .filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (value: AssistantReadingChoice) => { onChange(value); setOpen(false); };
  return <div className="mb-2 min-w-0 text-xs" aria-label="本次阅读对象">
    <div className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 text-muted-foreground">{busy ? '下条消息' : '阅读对象'}</span>
      <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(''); }}>
        <PopoverTrigger asChild><Button size="xs" variant="ghost" className="min-w-0 flex-1 justify-start"
          aria-label={`更换阅读对象：${context.label}`} title={context.label}>
          <FileText className="shrink-0" size={12} /><span className="truncate">{context.label}</span><ChevronDown className="ml-auto shrink-0" size={12} />
        </Button></PopoverTrigger>
        <PopoverContent viewportAligned align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
          <Input aria-label="搜索论文或笔记" placeholder="搜索论文或笔记" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="mt-1 max-h-64 overflow-y-auto overscroll-contain" role="group" aria-label="可选阅读对象">
            <Button className="w-full justify-start" size="sm" variant={!choice ? 'secondary' : 'ghost'} onClick={() => choose(null)}>跟随阅读（已附选区优先）</Button>
            {candidates.slice(0, 60).map(item => <Button key={`${item.entryId}/${item.noteId ?? ''}`} size="sm" variant="ghost"
              className="h-auto w-full justify-start py-1.5 text-left" onClick={() => choose({ entryId: item.entryId, noteId: item.noteId })}>
              <span className="min-w-0"><span className="block truncate">{item.label}</span><span className="block truncate text-[11px] text-muted-foreground">{item.description}</span></span>
            </Button>)}
            {!candidates.length ? <p className="p-2 text-muted-foreground">没有匹配的论文或笔记。</p> : null}
            {candidates.length > 60 ? <p className="p-2 text-muted-foreground">请继续输入名称缩小范围。</p> : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
    <p className={`mt-1 text-[11px] ${context.unavailable ? 'text-destructive' : 'text-muted-foreground'}`} role={context.unavailable ? 'alert' : undefined}>
      {context.unavailable ? '对象已不可用，请重新选择后发送。' : `${context.note ? '笔记' : context.bound ? '已固定' : '跟随阅读'} · 发送后切换页面不影响本次任务`}
    </p>
  </div>;
}
