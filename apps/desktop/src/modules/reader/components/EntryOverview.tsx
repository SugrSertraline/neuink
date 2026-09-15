import {
  FileText,
  FileType,
  Highlighter,
  Link2,
  Pencil,
  ScrollText,
  StickyNote,
  Tags
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EntryEditDialog } from '@/modules/library/components/EntryEditDialog';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { TagDisplaySettingsMenu } from '@/modules/library/components/TagDisplaySettingsMenu';
import { useTagPreferences } from '@/shared/components/TagPreferencesProvider';
import { getVisibleEntryTags } from '@/shared/lib/tagPreferences';
import type { TagMeta } from '@/shared/types/domain';
import type { PdfReaderResponse } from '@/shared/ipc/workspaceApi';
import { useEntryTagSuggestions } from './pdf-reader/useEntryTagSuggestions';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { SourceBacklinksBySegmentUid } from '../types';
import { EntryContentHeader } from './EntryContentHeader';
import { ReaderSection, ReaderSurfaceBody } from './ReaderSurfacePrimitives';
import { ReadingExportDialog } from '../export/ReadingExportDialog';

export function EntryOverview({
  entry,
  onUpdateEntry,
  sourceBacklinksBySegmentUid,
  tags,
  workspaceRoot,
  onReadPdfReader,
  onApplyEntryTagPaths,
  onOpenContent
}: {
  entry: LibraryEntry;
  onUpdateEntry: (
    entryId: string,
    request: { fields: Record<string, string>; tagPaths: string[]; title: string }
  ) => Promise<unknown> | unknown;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  tags: TagMeta[];
  workspaceRoot?: string | null;
  onReadPdfReader?: (entryId: string) => Promise<PdfReaderResponse>;
  onApplyEntryTagPaths?: (entryId: string, tagPaths: string[]) => Promise<unknown> | unknown;
  onOpenContent: (contentId: 'pdf' | 'reflow' | 'segment-notes' | 'source-links') => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [segments, setSegments] = useState<PdfReaderResponse['segments']>([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const tagSuggestions = useEntryTagSuggestions({
    autoRun: false,
    entry,
    onApplyEntryTagPaths: onApplyEntryTagPaths ?? (async () => undefined),
    segments,
    workspaceRoot: workspaceRoot ?? null
  });
  const loadAndGenerateTags = async () => {
    if (tagSuggestions.busy) return;
    if (segments.length === 0) {
      if (!onReadPdfReader) return;
      const data = await onReadPdfReader(entry.id);
      setSegments(data.segments);
      await tagSuggestions.generate(data.segments);
      return;
    }
    await tagSuggestions.generate();
  };
  const tagPaths = useMemo(() => {
    const pathById = buildTagPathById(tags);
    const resolved = entry.tagIds
      .map((tagId) => pathById.get(tagId))
      .filter((value): value is string => Boolean(value));
    return [...new Set(resolved.length > 0 ? resolved : entry.tags)].sort((left, right) =>
      left.localeCompare(right, 'zh-CN')
    );
  }, [entry.tagIds, entry.tags, tags]);
  const { preferences } = useTagPreferences();
  const visibleTagPaths = getVisibleEntryTags(tagPaths, preferences.onlyMostSpecificTags);
  const hiddenAncestorCount = tagPaths.length - visibleTagPaths.length;
  const description = entry.fields.description?.trim() || entry.fields['描述']?.trim() || '';
  const customFields = Object.entries(entry.fields)
    .filter(([key, value]) => key.toLowerCase() !== 'description' && key !== '描述' && value.trim())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
  const sourceLinkCount = Object.values(sourceBacklinksBySegmentUid)
    .flat()
    .filter((item) => item.sourceEntryId === entry.id).length;
  const noteCount = entry.contents.filter((content) => content.kind === 'note').length;

  return (
    <div className="entry-overview grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card">
      <EntryContentHeader className="bg-card" contentTitle="条目概览" entryTitle={entry.title}>
        <Button disabled={!workspaceRoot} size="xs" variant="outline" onClick={() => setExportOpen(true)}>导出阅读成果</Button>
        <Button
          size="icon-sm"
          title="编辑条目"
          type="button"
          variant="outline"
          onClick={() => setEditOpen(true)}
        >
          <Pencil size={14} aria-hidden="true" />
        </Button>
      </EntryContentHeader>
      <ReaderSurfaceBody width="full" className="entry-overview-body overflow-x-hidden bg-card">
        <section className="entry-overview-summary rounded-lg border bg-card px-5 py-5">
          <div className="text-xs font-medium text-muted-foreground">条目标题</div>
          <h1 className="entry-overview-breakable mt-1 text-xl font-semibold leading-8 text-foreground">
            {entry.title}
          </h1>
          <div className="mt-4 border-t pt-4">
            <div className="text-xs font-medium text-muted-foreground">描述</div>
            {description ? (
              <p className="entry-overview-breakable mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground">{description}</p>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">暂无描述。</p>
            )}
          </div>
        </section>

        <ReaderSection
          className="entry-overview-section"
          title="快速打开"
          description="从概览继续阅读或查看此条目的相关内容"
        >
          {entry.pdfFileName ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" type="button" onClick={() => onOpenContent('pdf')}>
                <FileType size={14} aria-hidden="true" />
                打开 PDF
              </Button>
              <Button size="sm" type="button" variant="outline" onClick={() => onOpenContent('reflow')}>
                <ScrollText size={14} aria-hidden="true" />
                打开重排视图
              </Button>
              <Button size="sm" type="button" variant="outline" onClick={() => onOpenContent('segment-notes')}>
                <StickyNote size={14} aria-hidden="true" />
                查看片段记录
              </Button>
              <Button size="sm" type="button" variant="outline" onClick={() => onOpenContent('source-links')}>
                <Link2 size={14} aria-hidden="true" />
                查看引用笔记
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              此条目尚未导入 PDF；可以从左侧“条目内容”补充 PDF。
            </p>
          )}
        </ReaderSection>

        <div className="entry-overview-stats grid gap-3">
          <OverviewStat icon={FileText} label="笔记" value={`${noteCount} 篇`} />
          <OverviewStat icon={Tags} label="标签" value={`${tagPaths.length} 个`} />
          <OverviewStat
            icon={Highlighter}
            label="解析状态"
            value={entry.status === 'Parsed' ? '已解析' : entry.status}
          />
          <OverviewStat icon={Link2} label="引用笔记" value={`${sourceLinkCount} 条`} />
        </div>

        <ReaderSection className="entry-overview-section" title="标签" actions={<TagDisplaySettingsMenu />} description={hiddenAncestorCount > 0 ? `显示 ${visibleTagPaths.length} 个最具体标签，隐藏 ${hiddenAncestorCount} 个重复上级标签；实际归属不变。` : '显示条目当前关联的完整标签路径'}>
          {tagPaths.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {visibleTagPaths.map((path) => (
                <span className="entry-overview-breakable min-w-0 max-w-full rounded-md border bg-muted/30 px-2 py-1 text-sm" key={path}>{path}</span>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">尚未添加标签。</span>
          )}
        </ReaderSection>

        <ReaderSection className="entry-overview-section" title="推荐标签" description="按需分析当前论文并选择要添加的标签">
          <div className="flex flex-wrap gap-1.5">
            {tagSuggestions.recommendations.slice(0, tagsExpanded ? undefined : 10).map((tag) => (
              <span className="entry-overview-breakable min-w-0 max-w-full rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-sm" key={tag.path}>
                {tag.path}
              </span>
            ))}
            {tagSuggestions.recommendations.length > 10 ? (
              <Button size="xs" type="button" variant="ghost" onClick={() => setTagsExpanded((value) => !value)}>
                {tagsExpanded ? '收起' : `… 还有 ${tagSuggestions.recommendations.length - 10} 个`}
              </Button>
            ) : null}
            {tagSuggestions.recommendations.length === 0 ? (
              <Button disabled={tagSuggestions.busy} size="sm" type="button" variant="outline" onClick={() => void loadAndGenerateTags()}>
                {tagSuggestions.busy ? '正在分析…' : '生成推荐标签'}
              </Button>
            ) : null}
            {tagSuggestions.recommendations.length > 0 ? (
              <Button disabled={tagSuggestions.busy} size="sm" type="button" variant="outline" onClick={() => void loadAndGenerateTags()}>
                重新生成
              </Button>
            ) : null}
          </div>
          {tagSuggestions.recommendations.length > 0 ? (
            <div className="mt-3 flex justify-end">
              <Button disabled={tagSuggestions.busy} size="sm" type="button" onClick={() => void tagSuggestions.apply()}>
                保存推荐标签
              </Button>
            </div>
          ) : null}
        </ReaderSection>

        {customFields.length > 0 ? (
          <ReaderSection className="entry-overview-section" title="条目属性" description="创建或编辑条目时保存的补充信息">
            <dl className="entry-overview-fields grid gap-x-8 gap-y-4">
              {customFields.map(([key, value]) => (
                <div className="min-w-0" key={key}>
                  <dt className="entry-overview-breakable text-xs font-medium text-muted-foreground">{key}</dt>
                  <dd className="entry-overview-breakable mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </ReaderSection>
        ) : null}

        <ReaderSection className="entry-overview-section" title="文件与时间">
          <dl className="entry-overview-fields grid gap-x-8 gap-y-4">
            <OverviewField label="原始 PDF" value={entry.pdfFileName ?? '未导入'} />
            <OverviewField label="条目状态" value={entry.status === 'Parsed' ? '已解析' : entry.status} />
            <OverviewField label="创建时间" value={formatOverviewDate(entry.createdAt)} />
            <OverviewField label="更新时间" value={formatOverviewDate(entry.updatedAt)} />
          </dl>
        </ReaderSection>
      </ReaderSurfaceBody>
      {editOpen ? (
        <EntryEditDialog
          entry={entry}
          open={editOpen}
          tags={tags}
          onOpenChange={setEditOpen}
          onUpdateEntry={onUpdateEntry}
        />
      ) : null}
      <ReadingExportDialog entryId={entry.id} entryTitle={entry.title} workspaceRoot={workspaceRoot ?? null} open={exportOpen} onOpenChange={setExportOpen} />
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
    <Card className="min-w-0 max-w-full" size="sm">
      <CardContent className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Icon size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="entry-overview-breakable mt-0.5 font-semibold text-foreground">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="entry-overview-breakable text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="entry-overview-breakable mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{value}</dd>
    </div>
  );
}

function formatOverviewDate(value: string) {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
