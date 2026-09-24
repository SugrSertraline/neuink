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
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from './EntryDisplay';
import { BookCover } from './book/BookCover';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import { EntryEditPage } from '@/modules/library/components/EntryEditPage';
import { EntryPdfActions, type EntryPdfHandlers } from '@/modules/library/components/EntryPdfActions';
import { EntryTagRecommendations } from './EntryTagRecommendations';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { TagDisplaySettingsMenu } from '@/modules/library/components/TagDisplaySettingsMenu';
import { useTagPreferences } from '@/shared/components/TagPreferencesProvider';
import { getVisibleEntryTags } from '@/shared/lib/tagPreferences';
import type { TagMeta } from '@/shared/types/domain';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { SourceBacklinksBySegmentUid } from '../types';
import { EntryContentHeader } from './EntryContentHeader';
import { ReaderSection, ReaderSurfaceBody } from './ReaderSurfacePrimitives';
import { ReadingExportDialog } from '../export/ReadingExportDialog';
import { ReaderSurfaceFrame } from './ReaderSurfaceFrame';

export function EntryOverview({
  entry,
  onUpdateEntry,
  sourceBacklinksBySegmentUid,
  tags,
  workspaceRoot,
  editorScopeKey = `entry-overview:${entry.id}`,
  onAttachPdf,
  onCreatePdfVersion,
  onImportMineruClientResult,
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
  editorScopeKey?: string;
  onApplyEntryTagPaths?: (entryId: string, tagPaths: string[]) => Promise<unknown> | unknown;
  onOpenContent: (contentId: 'pdf' | 'reflow' | 'segment-notes' | 'source-links') => void;
} & EntryPdfHandlers) {
  const [editOpen, setEditOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editOpen) editButton.current?.focus();
    wasEditing.current = editOpen;
  }, [editOpen]);
  const [exportOpen, setExportOpen] = useState(false);
  const { appearance } = useAppearance();
  const tagPaths = useMemo(() => {
    const pathById = buildTagPathById(tags);
    const resolved = entry.tagIds
      .map((tagId) => pathById.get(tagId))
      .filter((value): value is string => Boolean(value));
    // Keep newly applied paths visible while the shared tag catalog refreshes.
    return [...new Set([...entry.tags, ...resolved])].sort((left, right) =>
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

  if (editOpen) return <EntryEditPage key={`${workspaceRoot}:${entry.id}`} entry={entry} tags={tags} workspaceRoot={workspaceRoot ?? null}
    scopeKey={editorScopeKey} onUpdateEntry={onUpdateEntry} onBack={() => setEditOpen(false)} />;

  return (
    <ReaderSurfaceFrame className="entry-overview bg-card" toolbar={
      <EntryContentHeader className="bg-card" contentTitle="条目概览" entryTitle={entry.title} showEntryTitle={false}>
        <Button disabled={!workspaceRoot} size="xs" variant="outline" onClick={() => setExportOpen(true)}>导出阅读成果</Button>
        <Button
          ref={editButton}
          size="xs"
          type="button"
          variant="outline"
          onClick={() => setEditOpen(true)}
        >
          <Pencil size={14} aria-hidden="true" />
          编辑条目
        </Button>
      </EntryContentHeader>
    }>
      <ReaderSurfaceBody width="full" className="entry-overview-body overflow-x-hidden bg-card">
        <section className="entry-overview-summary rounded-lg border bg-card px-5 py-5">
          {appearance === 'atelier' ? <div className="entry-overview-cover"><BookCover id={entry.id} title={entry.title} topic={visibleTagPaths[0]?.split('/').pop() || '研究札记'} mode="overview"/></div> : null}
          <div className="entry-overview-summary-content min-w-0 flex-1">
          <h1 className="entry-overview-breakable mt-1 text-xl font-semibold leading-8 text-foreground">
            {entry.title}
          </h1>
          <div className="mt-3">
            {description ? (
              <p className="entry-overview-breakable mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground">{description}</p>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground">暂无描述。</p>
            )}
          </div>
          <div className="entry-overview-actions mt-4">
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
              此条目尚未导入 PDF；可以在下方“文件与时间”中上传。
            </p>
          )}
          </div>
          </div>
        </section>

        <div className="entry-overview-stats flex flex-wrap gap-x-6 gap-y-2" aria-label="条目统计">
          <OverviewStat icon={FileText} label="笔记" value={`${noteCount} 篇`} />
          <OverviewStat icon={Tags} label="标签" value={`${tagPaths.length} 个`} />
          <OverviewStat
            icon={Highlighter}
            label="解析状态"
            value={<StatusBadge status={entry.status}/>}
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

        <EntryTagRecommendations entry={entry} workspaceRoot={workspaceRoot ?? null} onApplyEntryTagPaths={onApplyEntryTagPaths} />

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
          <div className="mb-4"><EntryPdfActions key={`${workspaceRoot}:${entry.id}`} entry={entry} onAttachPdf={onAttachPdf} onCreatePdfVersion={onCreatePdfVersion} onImportMineruClientResult={onImportMineruClientResult} /></div>
          <dl className="entry-overview-fields grid gap-x-8 gap-y-4">
            <OverviewField label="原始 PDF" value={entry.pdfFileName ?? '未导入'} />
            <OverviewField label="创建时间" value={formatOverviewDate(entry.createdAt)} />
            <OverviewField label="更新时间" value={formatOverviewDate(entry.updatedAt)} />
          </dl>
        </ReaderSection>
      </ReaderSurfaceBody>
      <ReadingExportDialog entryId={entry.id} entryTitle={entry.title} workspaceRoot={workspaceRoot ?? null} open={exportOpen} onOpenChange={setExportOpen} />
    </ReaderSurfaceFrame>
  );
}

function OverviewStat({
  icon: Icon,
  label,
  value
}: {
  icon: typeof FileText;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden="true"/>
      <span className="text-muted-foreground">{label}</span>
      <span className="entry-overview-breakable font-medium text-foreground">{value}</span>
    </div>
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
