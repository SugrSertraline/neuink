import { AlertTriangle, FileText, StickyNote, TextSearch } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import type { SearchHit, SearchResults } from '@/shared/ipc/workspaceApi';

import { SearchResultPreview } from './SearchResultPreview';

type SearchResultListProps = {
  className?: string;
  hoverPreviewEnabled?: boolean;
  results: SearchResults | null;
  root: string | null;
  onOpenResult: (hit: SearchHit) => void;
};

export function SearchResultList({
  className,
  hoverPreviewEnabled = true,
  results,
  root,
  onOpenResult
}: SearchResultListProps) {
  if (!results) {
    return (
      <Empty className={cn('min-h-40 border-0 px-4 text-xs', className)}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TextSearch aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>输入关键词开始搜索</EmptyTitle>
          <EmptyDescription>搜索条目、标签、笔记和原文片段。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const warnings = results.warnings ?? [];

  if (results.total_hit_count === 0) {
    return (
      <Empty className={cn('min-h-40 border-0 px-4 py-5 text-xs', className)}>
        <SearchWarnings warnings={warnings} />
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TextSearch aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>没有找到匹配结果</EmptyTitle>
          <EmptyDescription>换一个关键词，或切换搜索模式后再试。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <CommandList
      className={cn(
        'search-result-scrollbar min-h-0 max-h-none overflow-x-hidden overflow-y-scroll overscroll-contain',
        className
      )}
    >
      <div className="space-y-3 p-2">
        <SearchWarnings warnings={warnings} />
        {results.entries.map((entry) => (
          <CommandGroup className="space-y-1 p-0" key={entry.entry_id}>
            <div className="flex items-center gap-2 px-1.5 py-1">
              <span className="min-w-0 flex-1 truncate text-xs font-extrabold">
                {entry.entry_title}
              </span>
              <Badge variant="secondary">{entry.hit_count}</Badge>
            </div>

            <div className="space-y-1">
              {entry.hits.map((hit, index) => {
                const key = `${hit.source.kind}-${hit.source.note_id ?? ''}-${hit.source.segment_uid ?? ''}-${index}`;
                const item = (
                  <SearchResultItem
                    entryTitle={entry.entry_title}
                    hit={hit}
                    index={index}
                    query={results.query}
                    onOpenResult={onOpenResult}
                  />
                );

                if (!hoverPreviewEnabled) {
                  return <div key={key}>{item}</div>;
                }

                return (
                  <HoverCard
                    key={key}
                    closeDelay={120}
                    openDelay={180}
                  >
                    <HoverCardTrigger asChild>
                      <div className="block">{item}</div>
                    </HoverCardTrigger>
                    <HoverCardContent
                      align="start"
                      className="w-[min(30rem,calc(100vw-2rem))] shadow-2xl"
                      collisionPadding={12}
                      side="right"
                      sideOffset={8}
                      sticky="always"
                    >
                      <SearchResultPreview
                        hit={hit}
                        query={results.query}
                        root={root}
                      />
                    </HoverCardContent>
                  </HoverCard>
                );
              })}
            </div>
          </CommandGroup>
        ))}
      </div>
      <CommandEmpty>
        <div className="py-6 text-center text-xs text-muted-foreground">
          没有可显示的结果
        </div>
      </CommandEmpty>
    </CommandList>
  );
}

function SearchResultItem({
  entryTitle,
  hit,
  index,
  query,
  onOpenResult
}: {
  entryTitle: string;
  hit: SearchHit;
  index: number;
  query: string;
  onOpenResult: (hit: SearchHit) => void;
}) {
  return (
    <CommandItem
      className="block w-full cursor-pointer rounded-md border border-transparent px-2.5 py-2 text-left text-xs transition-colors data-selected:border-primary/20 data-selected:bg-accent"
      value={`${entryTitle} ${hit.title} ${hit.snippet} ${hit.source.label} ${index}`}
      onSelect={() => onOpenResult(hit)}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
          <ResultIcon hit={hit} />
        </span>
        <span className="min-w-0 flex-1 truncate font-bold">
          {hit.title}
        </span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
          {hit.source.label}
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
        <span className="shrink-0 font-semibold text-foreground/70">
          出处
        </span>
        <span className="min-w-0 truncate">
          {entryTitle} / {hit.source.label}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-3 leading-5 text-muted-foreground">
        <SnippetText
          query={query}
          terms={hit.matched_terms}
          text={hit.snippet}
        />
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {hit.matched_terms.slice(0, 4).map((term) => (
          <span
            className={cn(
              'rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary',
              term.length > 8 && 'max-w-24 truncate'
            )}
            key={term}
          >
            {term}
          </span>
        ))}
      </div>
    </CommandItem>
  );
}

function SearchWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-left text-[11px] leading-4 text-amber-800 dark:text-amber-200">
      {warnings.map((warning) => (
        <div className="flex gap-1.5" key={warning}>
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

function SnippetText({
  query,
  terms,
  text
}: {
  query: string;
  terms: string[];
  text: string;
}) {
  const needles = Array.from(
    new Set([query.trim(), ...terms].filter((term) => term.trim().length > 0))
  ).sort((left, right) => right.length - left.length);

  if (needles.length === 0) {
    return <>{text}</>;
  }

  const lowerText = text.toLocaleLowerCase();
  const lowerNeedles = needles.map((term) => term.toLocaleLowerCase());
  const parts: Array<{ highlight: boolean; value: string }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextIndex = -1;
    let nextNeedle = '';

    lowerNeedles.forEach((needle, index) => {
      const found = lowerText.indexOf(needle, cursor);
      if (
        found >= 0 &&
        (nextIndex < 0 ||
          found < nextIndex ||
          (found === nextIndex && needle.length > nextNeedle.length))
      ) {
        nextIndex = found;
        nextNeedle = needles[index];
      }
    });

    if (nextIndex < 0) {
      parts.push({ highlight: false, value: text.slice(cursor) });
      break;
    }

    if (nextIndex > cursor) {
      parts.push({ highlight: false, value: text.slice(cursor, nextIndex) });
    }

    parts.push({
      highlight: true,
      value: text.slice(nextIndex, nextIndex + nextNeedle.length)
    });
    cursor = nextIndex + nextNeedle.length;
  }

  return (
    <>
      {parts.map((part, index) =>
        part.highlight ? (
          <mark
            className="rounded bg-primary/15 px-0.5 font-semibold text-primary"
            key={`${part.value}-${index}`}
          >
            {part.value}
          </mark>
        ) : (
          <span key={`${part.value}-${index}`}>{part.value}</span>
        )
      )}
    </>
  );
}

function ResultIcon({ hit }: { hit: SearchHit }) {
  if (hit.target.kind === 'segment') {
    return <TextSearch size={13} aria-hidden="true" />;
  }
  if (hit.target.kind === 'note') {
    return <StickyNote size={13} aria-hidden="true" />;
  }
  return <FileText size={13} aria-hidden="true" />;
}
