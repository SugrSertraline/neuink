import { ChevronRight, Tags } from 'lucide-react';
import { useId } from 'react';

import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import { useTagPreferences } from '@/shared/components/TagPreferencesProvider';
import { getEntryTagLabel, getVisibleEntryTags } from '@/shared/lib/tagPreferences';

export function EntryTagBadges({ tags, compact = false }: { tags: string[]; compact?: boolean }) {
  const previewId = useId();
  const { preferences } = useTagPreferences();
  const visible = getVisibleEntryTags(tags, preferences.onlyMostSpecificTags);
  const hiddenAncestors = new Set(tags).size - visible.length;
  if (!visible.length) return compact ? <span className="text-xs text-muted-foreground">未分类</span> : <Badge variant="outline">无标签</Badge>;

  return (
    <div className="entry-tag-badges min-w-0 max-w-full">
      <HoverCard>
        <HoverCardTrigger asChild openOnClick>
          <button
            aria-label={`查看全部 ${visible.length} 个标签`}
            aria-description={visible.join('；')}
            aria-describedby={previewId}
            data-multiple={visible.length > 1}
            className={cn('entry-tag-trigger flex h-6 w-full min-w-0 items-center justify-center gap-1 overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50', compact && 'justify-start text-left')}
            type="button"
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
          >
            <Badge className="entry-tag-primary min-w-0 gap-1.5" variant="secondary">
              <span className="truncate">{getEntryTagLabel(visible[0], visible)}</span>
            </Badge>
            {visible.length > 1 ? <Badge className="entry-tag-secondary min-w-0 gap-1.5" variant="secondary">
              <span className="truncate">{getEntryTagLabel(visible[1], visible)}</span>
            </Badge> : null}
            {visible.length > 2 ? <Badge className="entry-tag-default-count shrink-0" variant="outline">+{visible.length - 2}</Badge> : null}
            {visible.length > 1 ? <Badge className="entry-tag-narrow-count hidden shrink-0" variant="outline">+{visible.length - 1}</Badge> : null}
            {visible.length > 1 ? <Badge className="entry-tag-compact-count hidden shrink-0 gap-1" variant="secondary"><Tags size={11} aria-hidden="true" />{visible.length}</Badge> : null}
          </button>
        </HoverCardTrigger>
        <HoverCardContent id={previewId} role="tooltip" aria-label="条目标签" align="start" className="w-80 p-3" side="top"
          onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
          <div className="mb-2 border-b pb-2">
            <p className="text-xs font-semibold">条目标签</p>
            <p className="text-[11px] text-muted-foreground">{hiddenAncestors ? `显示 ${visible.length} 个 · 已隐藏 ${hiddenAncestors} 个重复上级标签` : `共 ${visible.length} 个标签`}</p>
          </div>
          <ul className="space-y-2">
            {visible.map(tag => <TagPath key={tag} path={tag} />)}
          </ul>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

function TagPath({ path }: { path: string }) {
  const segments = path.split('/').map(part => part.trim()).filter(Boolean);
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs" aria-label={path}>
      {segments.map((segment, index) => <span className="contents" key={`${segment}:${index}`}>
        {index > 0 ? <ChevronRight className="shrink-0 text-muted-foreground" size={11} aria-hidden="true" /> : null}
        {index === segments.length - 1
          ? <Badge variant="secondary" className="h-auto min-h-5 max-w-full justify-start whitespace-normal [overflow-wrap:anywhere]">{segment}</Badge>
          : <span className="max-w-full text-muted-foreground [overflow-wrap:anywhere]">{segment}</span>}
      </span>)}
    </li>
  );
}
