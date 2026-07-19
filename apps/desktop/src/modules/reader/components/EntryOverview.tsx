import { FileText, Highlighter, Link2, Tags } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import type { TagMeta } from '@/shared/types/domain';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { SourceBacklinksBySegmentUid } from '../types';
import { EntryContentHeader } from './EntryContentHeader';
import { ReaderSection, ReaderSurfaceBody } from './ReaderSurfacePrimitives';

export function EntryOverview({
  entry,
  sourceBacklinksBySegmentUid,
  tags
}: {
  entry: LibraryEntry;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  tags: TagMeta[];
}) {
  const tagPaths = useMemo(() => {
    const pathById = buildTagPathById(tags);
    const resolved = entry.tagIds
      .map((tagId) => pathById.get(tagId))
      .filter((value): value is string => Boolean(value));
    return [...new Set(resolved.length > 0 ? resolved : entry.tags)].sort((left, right) =>
      left.localeCompare(right, 'zh-CN')
    );
  }, [entry.tagIds, entry.tags, tags]);
  const description = entry.fields.description?.trim() ?? '';
  const customFields = Object.entries(entry.fields)
    .filter(([key, value]) => key.toLowerCase() !== 'description' && value.trim())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  const sourceLinkCount = Object.values(sourceBacklinksBySegmentUid)
    .flat()
    .filter((item) => item.sourceEntryId === entry.id).length;
  const noteCount = entry.contents.filter((content) => content.kind === 'note').length;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <EntryContentHeader contentTitle="条目概览" entryTitle={entry.title} />
      <ReaderSurfaceBody>
        <section className="rounded-lg border bg-card px-5 py-5 sm:px-6">
          <div className="text-xs font-medium text-muted-foreground">条目标题</div>
          <h1 className="mt-1 break-words text-xl font-semibold leading-8 text-foreground">
            {entry.title}
          </h1>
          <div className="mt-4 border-t pt-4">
            <div className="text-xs font-medium text-muted-foreground">描述</div>
            {description ? (
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
                {description}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">暂无描述。</p>
            )}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewStat icon={FileText} label="笔记" value={`${noteCount} 篇`} />
          <OverviewStat icon={Tags} label="标签" value={`${tagPaths.length} 个`} />
          <OverviewStat
            icon={Highlighter}
            label="解析状态"
            value={entry.status === 'Parsed' ? '已解析' : entry.status}
          />
          <OverviewStat icon={Link2} label="来源链接" value={`${sourceLinkCount} 条`} />
        </div>

        <ReaderSection title="标签" description="显示条目当前关联的完整标签路径">
          {tagPaths.length > 0 ? (
            <div className="flex flex-wrap items-start gap-2">
              {tagPaths.map((path) => (
                <Badge
                  className="h-auto max-w-full whitespace-normal break-all px-2.5 py-1 text-left leading-5"
                  key={path}
                  title={path}
                  variant="secondary"
                >
                  {path}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">尚未添加标签。</span>
          )}
        </ReaderSection>

        {customFields.length > 0 ? (
          <ReaderSection title="条目属性" description="创建或编辑条目时保存的补充信息">
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {customFields.map(([key, value]) => (
                <div className="min-w-0" key={key}>
                  <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </ReaderSection>
        ) : null}

        <ReaderSection title="文件与时间">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <OverviewField label="原始 PDF" value={entry.pdfFileName ?? '未导入'} />
            <OverviewField label="条目状态" value={entry.status === 'Parsed' ? '已解析' : entry.status} />
            <OverviewField label="创建时间" value={formatOverviewDate(entry.createdAt)} />
            <OverviewField label="更新时间" value={formatOverviewDate(entry.updatedAt)} />
          </dl>
        </ReaderSection>
      </ReaderSurfaceBody>
    </div>
  );
}

function OverviewStat({
  icon: Icon,
  label,
  value
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Icon size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-0.5 break-words font-semibold text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{value}</dd>
    </div>
  );
}

function formatOverviewDate(value: string) {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
