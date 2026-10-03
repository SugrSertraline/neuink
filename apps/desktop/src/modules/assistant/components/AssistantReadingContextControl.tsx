import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, FileText, Globe, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import type { TagMeta } from '@/shared/types/domain';
import type { AssistantReadingChoice, AssistantReadingContext } from './assistantReadingContext';

type TargetKind = 'tag' | 'entry' | 'pdf' | 'note';
type ReadingTarget = { id: string; kind: TargetKind; label: string; description: string; choice: AssistantReadingChoice };
const kinds: Array<{ id: TargetKind; label: string }> = [
  { id: 'tag', label: '标签' }, { id: 'entry', label: '条目' },
  { id: 'pdf', label: 'PDF' }, { id: 'note', label: '笔记' }
];

export function AssistantReadingContextControl({ context, entries, tags, busy, choice, onChange }: {
  context: AssistantReadingContext; entries: LibraryEntry[]; tags?: TagMeta[]; busy: boolean;
  choice: AssistantReadingChoice; onChange: (choice: AssistantReadingChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TargetKind>('tag');
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => {
    const allTags = tags ?? [];
    const paths = buildTagPathById(allTags);
    return [
      ...allTags.map((tag): ReadingTarget => ({ id: `tag:${tag.id}`, kind: 'tag', label: tag.name,
        description: paths.get(tag.id) ?? tag.name, choice: { tagId: tag.id } })),
      ...entries.flatMap((entry): ReadingTarget[] => [
        { id: `entry:${entry.id}`, kind: 'entry', label: entry.title,
          description: '条目概览', choice: { entryId: entry.id } },
        ...(entry.pdfFileName ? [{ id: `pdf:${entry.id}`, kind: 'pdf' as const, label: entry.pdfFileName,
          description: entry.title, choice: { entryId: entry.id, contentKind: 'pdf' as const } }] : []),
        ...entry.contents.flatMap(content => content.kind === 'note' ? [{ id: `note:${entry.id}:${content.note_id}`,
          kind: 'note' as const, label: content.title, description: entry.title,
          choice: { entryId: entry.id, noteId: content.note_id } }] : [])
      ])
    ].sort((left, right) => left.label.localeCompare(right.label));
  }, [entries, tags]);
  const candidates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return targets.filter(target => target.kind === kind && (!term ||
      `${target.label} ${target.description}`.toLocaleLowerCase().includes(term)));
  }, [targets, kind, query]);
  const virtualizer = useVirtualizer({ count: candidates.length, getScrollElement: () => scroll.current,
    estimateSize: () => 48, initialRect: { width: 320, height: 224 }, overscan: 5 });
  const virtualize = candidates.length > 30;
  const rows = virtualize ? virtualizer.getVirtualItems() : candidates.map((_, index) => ({ index, start: index * 48 }));
  const highlightedIndex = Math.min(activeIndex, Math.max(0, candidates.length - 1));
  const choose = (value: AssistantReadingChoice) => { onChange(value); setOpen(false); setQuery(''); };
  const selectKind = (next: TargetKind) => { setKind(next); setQuery(''); setActiveIndex(0);
    virtualizer.scrollToOffset(0); input.current?.focus(); };
  return <div className="mb-2 min-w-0 text-xs" aria-label="本次阅读对象">
    <div className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 text-muted-foreground">{busy ? '下条消息' : '阅读对象'}</span>
      <Popover open={open} onOpenChange={value => {
        setOpen(value);
        setQuery('');
        setActiveIndex(0);
        if (value) setKind(choice && choice !== 'none' ? 'tagId' in choice ? 'tag' : choice.noteId ? 'note' : choice.contentKind === 'pdf' ? 'pdf' : 'entry' : 'tag');
      }}>
        <PopoverTrigger asChild><Button ref={trigger} size="xs" variant="ghost" className="min-w-0 flex-1 justify-start"
          aria-label={`更换阅读对象：${context.label}`} title={context.label}>
          {context.surface.kind === 'browser' ? <Globe className="shrink-0" size={12} /> : <FileText className="shrink-0" size={12} />}<span className="truncate">{context.label}</span><ChevronDown className="ml-auto shrink-0" size={12} />
        </Button></PopoverTrigger>
        <PopoverContent viewportAligned align="start" side="top"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] gap-1 p-2">
          <div className="max-h-20 shrink-0 space-y-1 overflow-y-auto" role="group" aria-label="阅读对象模式">
            <Button className="w-full justify-start" size="sm" aria-pressed={choice === null} variant={choice === null ? 'secondary' : 'ghost'} onClick={() => choose(null)}>跟随当前标签页（已附选区优先）</Button>
            <Button className="w-full justify-start" size="sm" aria-pressed={choice === 'none'} variant={choice === 'none' ? 'secondary' : 'ghost'} onClick={() => choose('none')}>不关联内容</Button>
          </div>
          <div className="flex shrink-0 gap-1 border-t pt-1" role="group" aria-label="阅读对象类型">
            {kinds.map(option => <Button key={option.id} size="xs" variant={kind === option.id ? 'secondary' : 'ghost'}
              aria-pressed={kind === option.id} onClick={() => selectKind(option.id)}>{option.label}</Button>)}
          </div>
          <Input ref={input} className="shrink-0" role="combobox" aria-expanded={true} aria-autocomplete="list"
            aria-label="搜索所选阅读对象" placeholder={`搜索${kinds.find(option => option.id === kind)?.label}`}
            value={query} aria-controls="assistant-reading-targets"
            aria-activedescendant={candidates.length ? `assistant-reading-target-${highlightedIndex}` : undefined}
            onChange={event => { setQuery(event.target.value); setActiveIndex(0); virtualizer.scrollToOffset(0); }}
            onKeyDown={event => {
              if (!candidates.length) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const next = (highlightedIndex + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
                setActiveIndex(next); virtualizer.scrollToIndex(next); return;
              }
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); choose(candidates[highlightedIndex].choice); }
            }} />
          <div id="assistant-reading-targets" ref={scroll} className="h-56 min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            role="listbox" aria-label="可选阅读对象">
            {candidates.length ? <div className="relative w-full" style={{ height: virtualize ? virtualizer.getTotalSize() : candidates.length * 48 }}>
              {rows.map(row => {
                const item = candidates[row.index];
                return <button key={item.id} id={`assistant-reading-target-${row.index}`} role="option" type="button"
                  aria-selected={row.index === highlightedIndex} tabIndex={-1}
                  className={`absolute left-0 flex h-12 w-full min-w-0 flex-col justify-center rounded-sm px-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${row.index === highlightedIndex ? 'bg-muted' : ''}`}
                  style={{ transform: `translateY(${row.start}px)` }} onMouseEnter={() => setActiveIndex(row.index)}
                  onClick={() => choose(item.choice)}>
                  <span className="w-full truncate font-medium" title={item.label}>{item.label}</span>
                  <span className="w-full truncate text-[11px] text-muted-foreground" title={item.description}>{item.description}</span>
                </button>;
              })}
            </div> : <p className="p-2 text-muted-foreground">没有匹配的{kind === 'tag' ? '标签' : kind === 'entry' ? '条目' : kind === 'pdf' ? 'PDF' : '笔记'}。</p>}
          </div>
        </PopoverContent>
      </Popover>
      {choice !== 'none' && <Button size="icon-xs" variant="ghost" className="shrink-0 text-muted-foreground"
        aria-label="取消关联阅读对象" title="取消关联阅读对象" onClick={() => { trigger.current?.focus(); choose('none'); }}><X size={12} /></Button>}
    </div>
    <p className={`mt-1 text-[11px] ${context.unavailable ? 'text-destructive' : 'text-muted-foreground'}`} role={context.unavailable ? 'alert' : undefined}>
      {context.unavailable ? '对象已不可用，请重新选择后发送。' : choice === 'none'
        ? '不跟随标签页；手动附加的资料和已有对话仍保留。'
        : context.surface.browserTab ? '跟随阅读 · 发送时固定网页，网页跳转后需重新提问'
          : `${context.tag ? '标签范围' : context.note ? '笔记' : context.bound ? '已固定' : '跟随阅读'} · 发送后切换页面不影响本次任务`}
    </p>
    {context.notice && <p role="status" className="mt-1 text-xs leading-5 text-muted-foreground">{context.notice}</p>}
    {!context.unavailable && !context.note && context.entry?.pdfFileName && context.entry.status !== 'Parsed' &&
      <p role="status" className="mt-1 text-xs leading-5 text-muted-foreground">PDF 尚未完成解析，仍可让助手按页读取或搜索文字。扫描件、图表和复杂排版需 OCR／完整解析；不会自动启动解析。</p>}
  </div>;
}
