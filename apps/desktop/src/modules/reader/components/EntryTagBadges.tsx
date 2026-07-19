import { ChevronRight, Tags } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

const TAG_ACCENTS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500'
] as const;

export function EntryTagBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <Badge variant="outline">无标签</Badge>;
  }

  return (
    <div className="entry-tag-badges min-w-0 max-w-full">
      <HoverCard closeDelay={120} openDelay={180}>
        <HoverCardTrigger asChild>
          <button
            aria-label={`查看全部 ${tags.length} 个标签`}
            className="entry-tag-trigger flex h-6 w-full min-w-0 items-center justify-center gap-1 overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            type="button"
            onClick={(event) => event.stopPropagation()}
          >
            <Badge
              className="entry-tag-primary max-w-28 min-w-0 gap-1.5 bg-secondary/80 transition-colors hover:bg-secondary"
              variant="secondary"
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', tagAccent(tags[0]))} />
              <span className="truncate">{leafTag(tags[0])}</span>
            </Badge>
            {tags.length > 1 ? (
              <Badge
                className="entry-tag-secondary max-w-28 min-w-0 gap-1.5 bg-secondary/80 transition-colors hover:bg-secondary"
                variant="secondary"
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', tagAccent(tags[1]))} />
                <span className="truncate">{leafTag(tags[1])}</span>
              </Badge>
            ) : null}
            {tags.length > 2 ? (
              <Badge className="entry-tag-default-count shrink-0" variant="outline">
                +{tags.length - 2}
              </Badge>
            ) : null}
            {tags.length > 1 ? (
              <Badge className="entry-tag-narrow-count hidden shrink-0" variant="outline">
                +{tags.length - 1}
              </Badge>
            ) : null}
            <Badge className="entry-tag-compact-count hidden shrink-0 gap-1" variant="secondary">
              <Tags size={11} aria-hidden="true" />
              {tags.length}
            </Badge>
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="center" className="w-80 p-0" side="top">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Tags size={14} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold">条目标签</p>
              <p className="text-[11px] text-muted-foreground">共 {tags.length} 个标签</p>
            </div>
          </div>
          <div className="grid max-h-64 gap-1 overflow-y-auto p-2">
            {tags.map((tag) => (
              <TagPath key={tag} path={tag} />
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}

function TagPath({ path }: { path: string }) {
  const segments = path.split('/').map((part) => part.trim()).filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/20 px-2 py-1.5">
      <span className={cn('size-2 shrink-0 rounded-full', tagAccent(path))} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5 gap-y-1 text-[11px]">
        {segments.map((segment, index) => (
          <span className="contents" key={`${segment}:${index}`}>
            {index > 0 ? (
              <ChevronRight className="shrink-0 text-muted-foreground/60" size={11} aria-hidden="true" />
            ) : null}
            <span className={cn(
              'max-w-full break-words',
              index === segments.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'
            )}>
              {segment}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function leafTag(path: string) {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function tagAccent(path: string) {
  let hash = 0;
  for (const character of path.split('/')[0] ?? path) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return TAG_ACCENTS[Math.abs(hash) % TAG_ACCENTS.length];
}
