import { Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SourceLink } from '@/shared/types/domain';

import type { SourceLinkOpenTarget } from '../editor/SourceLinkNode';

type SourceLinksPanelProps = {
  filters: string[];
  links: SourceLink[];
  onFilterChange: (filter: string) => void;
  onLocate: (anchorId: string) => void;
  onOpenSourceLink?: (target: SourceLinkOpenTarget) => void;
  selectedFilter: string;
  totalCount: number;
};

export function SourceLinksPanel({
  filters,
  links,
  onFilterChange,
  onLocate,
  onOpenSourceLink,
  selectedFilter,
  totalCount
}: SourceLinksPanelProps) {
  return (
    <aside className="mb-2 min-w-0 rounded-md border bg-muted/20 p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-1 text-xs font-semibold text-foreground">
          <Link2 size={13} aria-hidden="true" />
          来源 {totalCount}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {filters.map((filter) => (
            <Button
              key={filter}
              size="xs"
              type="button"
              variant={selectedFilter === filter ? 'secondary' : 'ghost'}
              onClick={() => onFilterChange(filter)}
            >
              {sourceFilterLabel(filter)}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-2 max-h-36 min-w-0 overflow-y-auto pr-1">
        <div className="grid gap-1">
          {links.map((link) => (
            <SourceLinkRow
              key={link.link_id}
              link={link}
              onLocate={onLocate}
              onOpenSourceLink={onOpenSourceLink}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

function SourceLinkRow({
  link,
  onLocate,
  onOpenSourceLink
}: {
  link: SourceLink;
  onLocate: (anchorId: string) => void;
  onOpenSourceLink?: (target: SourceLinkOpenTarget) => void;
}) {
  const source = link.sources[0];
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-sm border bg-background px-2 py-1.5 text-xs">
      <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLocate(link.anchor_id)}>
        <div className="truncate font-medium text-foreground">
          {link.display_text || `p.${source?.page ?? '?'}`}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {source
            ? `p.${source.page} · ${sourceFilterLabel(source.segment_type ?? 'unknown')}`
            : link.anchor_id}
        </div>
      </button>
      {source && onOpenSourceLink ? (
        <Button
          size="xs"
          type="button"
          variant="outline"
          onClick={() =>
            onOpenSourceLink({
              page: source.page,
              segmentUid: source.segment_uid,
              sourceEntryId: source.entry_id
            })
          }
        >
          打开
        </Button>
      ) : null}
    </div>
  );
}

function sourceFilterLabel(filter: string) {
  const labels: Record<string, string> = {
    all: '全部',
    code: '代码',
    equation: '公式',
    figure: '图',
    heading: '标题',
    image: '图',
    list: '列表',
    table: '表格',
    text: '文本',
    title: '标题',
    unknown: '未知'
  };
  return labels[filter] ?? filter;
}
