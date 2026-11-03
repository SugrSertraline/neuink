import { ChevronRight, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { TagDescriptionField } from '@/modules/library/components/TagDescriptionField';
import type { TagMeta } from '@/shared/types/domain';
import type { LibraryView } from '@/modules/library/utils/libraryView';
import { LibraryViewMenu } from './LibraryViewMenu';

export function LibraryHeading({ title, summary, tag, ancestors, hasTagContext, view, onSelectView, onClearFilters, onManageTags, onNavigate, onDescription, disabled, workspaceRoot, actions }: {
  title: string; summary: string; tag?: TagMeta | null; ancestors: Pick<TagMeta, 'id' | 'name'>[]; workspaceRoot: string | null;
  hasTagContext: boolean; view: LibraryView; onSelectView: (view: LibraryView) => void; onClearFilters: () => void; onManageTags: () => void;
  disabled: boolean; onNavigate: (tagId: string | null) => void;
  onDescription?: (id: string, value: string, expected: string) => Promise<TagMeta>;
  actions: ReactNode;
}) {
  return <header aria-label="条目库页眉" data-material="workspace-heading" className="@container/library-heading shrink-0 border-b bg-card px-3 py-2">
    <nav aria-label="条目库浏览路径" className="flex min-h-8 min-w-0 flex-wrap items-center gap-1">
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="outline" className="shrink-0" title="清除所有筛选并显示全部条目" onClick={onClearFilters}>显示全部</Button>
        <ChevronRight size={12} className="text-muted-foreground" aria-hidden="true" />
        {hasTagContext ? <LibraryViewMenu view={view} onSelect={onSelectView} /> : <h1 aria-label={title} className="shrink-0" title={title}><LibraryViewMenu view={view} onSelect={onSelectView} /></h1>}
      </div>
      {hasTagContext ? <div className="flex min-w-0 max-w-full flex-[1_1_120px] items-center gap-1">
        <ChevronRight size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <Button size="xs" variant="ghost" className="shrink-0 px-1 text-muted-foreground" title="清除标签筛选，保留当前条目范围" onClick={() => onNavigate(null)}>全部标签</Button>
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
        <h1 aria-current="location" className="min-w-0 truncate text-base font-semibold" title={title}>{title}</h1>
      </div> : null}
      <Button size="xs" variant="ghost" className="ml-auto shrink-0 text-muted-foreground" onClick={onManageTags} disabled={disabled}>标签管理</Button>
    </nav>
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <p className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground" title={summary}>{summary}</p>
      <div aria-label="条目库操作" className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
    </div>
    {tag && onDescription ? <div className="mt-1 grid min-h-7 min-w-0 grid-cols-[0_minmax(32px,1fr)_auto] items-center">
      <TagDescriptionField key={`${workspaceRoot}:${tag.id}`} tag={tag} scope={`library/tag:${tag.id}`} disabled={disabled} onSave={onDescription} inline />
    </div> : null}
  </header>;
}
