import { ChevronRight, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TagDescriptionField } from '@/modules/library/components/TagDescriptionField';
import type { TagMeta } from '@/shared/types/domain';

export function LibraryHeading({ title, summary, tag, ancestors, onNavigate, onDescription, disabled, workspaceRoot, actions, contextActions }: {
  title: string; summary: string; tag?: TagMeta | null; ancestors: Pick<TagMeta, 'id' | 'name'>[]; workspaceRoot: string | null;
  disabled: boolean; onNavigate: (tagId: string | null) => void;
  onDescription?: (id: string, value: string, expected: string) => Promise<TagMeta>;
  actions: ReactNode;
  contextActions?: ReactNode;
}) {
  return <header aria-label="条目库页眉" className="@container/library-heading shrink-0 border-b bg-card px-3 py-2">
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-[1_1_160px]">
        <nav aria-label="标签浏览路径" className="flex min-h-8 min-w-0 items-center gap-1">
          {tag ? <>
            <Button size="xs" variant="ghost" className="shrink-0 px-1 text-muted-foreground" onClick={() => onNavigate(null)}>全部条目</Button>
            {ancestors.length > 0 ? <>
            <div className={cn('hidden min-w-0 max-w-[50%] items-center gap-1', ancestors.length <= 2 && '@min-[900px]/library-heading:flex')}>{ancestors.map(ancestor => <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <Button size="xs" variant="ghost" className="min-w-0 max-w-32 shrink px-1 text-muted-foreground" title={ancestor.name} onClick={() => onNavigate(ancestor.id)}><span className="truncate">{ancestor.name}</span></Button>
            </span>)}</div>
            <div className={cn('flex shrink-0 items-center gap-1', ancestors.length <= 2 && '@min-[900px]/library-heading:hidden')}>
              <ChevronRight size={12} className="text-muted-foreground" aria-hidden="true" />
              <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="上级标签" title={`上级标签：${ancestors.map(tag => tag.name).join(' / ')}`}><MoreHorizontal size={13} aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" viewportAligned className="max-w-64">
                  <DropdownMenuLabel>上级标签</DropdownMenuLabel>
                  {ancestors.map(ancestor => <DropdownMenuItem key={ancestor.id} onSelect={() => onNavigate(ancestor.id)} title={ancestor.name}><span className="truncate">{ancestor.name}</span></DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            </> : null}
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </> : null}
          <h1 aria-current={tag ? 'location' : undefined} className="min-w-0 truncate text-base font-semibold" title={title}>{title}</h1>
        </nav>
      </div>
      <div aria-label="条目库操作" className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </div>
    <div className="mt-1 grid min-h-7 min-w-0 grid-cols-[minmax(0,auto)_minmax(32px,1fr)_auto] items-center gap-x-3">
      <p className="col-start-1 row-start-1 max-w-72 truncate text-xs text-muted-foreground" title={summary}>{summary}</p>
      {tag && onDescription ? <TagDescriptionField key={`${workspaceRoot}:${tag.id}`} tag={tag} scope={`library/tag:${tag.id}`} disabled={disabled} onSave={onDescription} inline /> : null}
      <div aria-label="条目库当前范围操作" className="col-start-3 row-start-1 flex items-center gap-2">{contextActions}</div>
    </div>
  </header>;
}
