import { FilterX, LocateFixed, MessageSquareText, RefreshCw, Search, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { pageLabel } from '@/shared/lib/uiTerminology';
import type { AnnotationCatalogRecord } from '@/shared/ipc/workspaceApi';
import type {
  Annotation,
  AnnotationId,
  AnnotationImportance,
  TagMeta
} from '@/shared/types/domain';

import { buildTagPathById, collectDescendantTagIds } from '../../library/utils/tagTree';
import { formatDate, TagBadges } from '../../reader/components/EntryDisplay';
import { EntryContentHeader } from '../../reader/components/EntryContentHeader';
import { ReaderEmptyState } from '../../reader/components/ReaderSurfacePrimitives';
import { segmentTypeLabel } from '../../reader/components/pdf-reader/readerUtils';
import {
  ANNOTATION_TYPES,
  IMPORTANCE_OPTIONS,
  annotationImportanceLabel,
  annotationImportanceRank,
  annotationKindLabel
} from '../annotationRegistry';

type AnnotationLibraryViewProps = {
  activeTag: string | null;
  annotations: AnnotationCatalogRecord[];
  entryTitle?: string;
  status: 'loading' | 'ready' | 'error';
  tags: TagMeta[];
  onOpenAnnotation: (record: AnnotationCatalogRecord) => void;
  onRefreshAnnotations: () => Promise<unknown> | unknown;
  standalone?: boolean;
};

type KindFilter = string | 'all';
type ImportanceFilter = AnnotationImportance | 'all';

export function AnnotationLibraryView({
  activeTag,
  annotations,
  entryTitle = '条目',
  status,
  tags,
  onOpenAnnotation,
  onRefreshAnnotations,
  standalone = false
}: AnnotationLibraryViewProps) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>('all');
  const [sortBy, setSortBy] = useState('recent');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<AnnotationId | null>(null);
  const tagPathById = useMemo(() => buildTagPathById(tags), [tags]);
  const activeTagIds = useMemo(
    () => (activeTag ? collectDescendantTagIds(tags, activeTag) : null),
    [activeTag, tags]
  );
  const activeTagLabel = activeTag ? tagPathById.get(activeTag) ?? activeTag : null;
  const filteredAnnotations = useMemo(
    () =>
      filterAnnotations({
        activeTagIds,
        annotations,
        importanceFilter,
        kindFilter,
        query,
        sortBy,
        tagPathById
      }),
    [activeTagIds, annotations, importanceFilter, kindFilter, query, sortBy, tagPathById]
  );
  const coreCount = annotations.filter((record) => record.annotation.importance === 'core').length;
  const orphanCount = annotations.filter((record) => record.segment_status !== 'current').length;
  const selectedRecord =
    (selectedAnnotationId
      ? filteredAnnotations.find((record) => record.annotation.annotation_id === selectedAnnotationId) ??
        annotations.find((record) => record.annotation.annotation_id === selectedAnnotationId)
      : null) ?? null;
  const selectedTagNames = useMemo(
    () =>
      (selectedRecord?.entry_tag_ids ?? [])
        .map((tagId) => tagPathById.get(tagId))
        .filter((value): value is string => Boolean(value)),
    [selectedRecord?.entry_tag_ids, tagPathById]
  );
  useEffect(() => {
    if (filteredAnnotations.length === 0) {
      setSelectedAnnotationId(null);
      return;
    }
    if (!selectedAnnotationId) {
      setSelectedAnnotationId(filteredAnnotations[0].annotation.annotation_id);
      return;
    }
    if (!filteredAnnotations.some((record) => record.annotation.annotation_id === selectedAnnotationId)) {
      setSelectedAnnotationId(filteredAnnotations[0].annotation.annotation_id);
    }
  }, [filteredAnnotations, selectedAnnotationId]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshAnnotations();
    } finally {
      setRefreshing(false);
    }
  };

  const content = (
      <div className="grid h-full min-h-0 gap-3">
        <Card className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] py-0">
          <EntryContentHeader contentTitle="批注" entryTitle={entryTitle}>
            <span className="min-w-0 flex-1" />
            <Button disabled={refreshing} size="sm" type="button" variant="outline" onClick={() => void refresh()}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} size={14} aria-hidden="true" />
              刷新
            </Button>
          </EntryContentHeader>

          <CardContent className="border-b py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-72 flex-1">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="搜索批注、原文片段、论文标题或标签"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as KindFilter)}>
                <SelectTrigger className="w-36" size="sm">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  {ANNOTATION_TYPES.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={importanceFilter}
                onValueChange={(value) => setImportanceFilter(value as ImportanceFilter)}
              >
                <SelectTrigger className="w-36" size="sm">
                  <SelectValue placeholder="重要性" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部重要性</SelectItem>
                  {IMPORTANCE_OPTIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-36" size="sm">
                  <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">最近更新</SelectItem>
                  <SelectItem value="importance">重要性</SelectItem>
                  <SelectItem value="entry">论文标题</SelectItem>
                  <SelectItem value="page">页码</SelectItem>
                </SelectContent>
              </Select>

              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setKindFilter('all');
                  setImportanceFilter('all');
                  setSortBy('recent');
                }}
              >
                <FilterX size={14} aria-hidden="true" />
                清除
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {activeTagLabel ? <Badge variant="secondary">标签：{activeTagLabel}</Badge> : null}
              <Badge variant="outline">共 {annotations.length} 条</Badge>
              <Badge variant="outline">筛选后 {filteredAnnotations.length} 条</Badge>
              <Badge variant="outline">核心 {coreCount}</Badge>
              {orphanCount > 0 ? <Badge variant="destructive">失联 {orphanCount}</Badge> : null}
            </div>
          </CardContent>

          <div className="grid min-h-0 grid-cols-[minmax(260px,0.55fr)_minmax(520px,1.45fr)]">
            <div className="grid min-h-0 border-r">
              <div className="min-h-0 overflow-auto">
                {status === 'loading' ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">正在打开批注视图...</div>
                ) : null}
                {status !== 'loading' && filteredAnnotations.length === 0 ? (
                  <ReaderEmptyState
                    className="m-3 min-h-48 px-4 py-8"
                    description="在 PDF 或重排视图中选择原文，即可创建批注。"
                    icon={MessageSquareText}
                    title="暂无批注"
                  />
                ) : null}
                {status !== 'loading' && filteredAnnotations.length > 0 ? (
                  <div className="divide-y">
                    {filteredAnnotations.map((record) => {
                      const isSelected = selectedAnnotationId === record.annotation.annotation_id;
                      return (
                        <button
                          className={cn(
                            'block w-full px-3 py-2 text-left transition-colors hover:bg-muted/35',
                            isSelected && 'bg-primary/5'
                          )}
                          key={record.annotation.annotation_id}
                          type="button"
                          onClick={() => setSelectedAnnotationId(record.annotation.annotation_id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium leading-5 text-foreground">
                                {record.entry_title}
                              </div>
                              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className="shrink-0">{formatSegmentLabel(record)}</span>
                                <span className="shrink-0">·</span>
                                <span className="truncate">{formatDate(record.annotation.updated_at)}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-1">
                                <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                  {annotationDisplayLabel(record.annotation)}
                                </span>
                                <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {annotationImportanceLabel(record.annotation.importance)}
                                </span>
                                {record.segment_status !== 'current' ? (
                                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                                    失联
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {isSelected ? <span className="mt-1 size-2 rounded-full bg-primary" /> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
              <div className="border-b bg-muted/25 px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {selectedRecord ? selectedRecord.entry_title : '批注详情'}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {selectedRecord ? formatSegmentLabel(selectedRecord) : '从左侧选择一条批注'}
                    </div>
                  </div>

                  {selectedRecord ? (
                    <Button
                      disabled={selectedRecord.segment_status !== 'current' || !selectedRecord.segment}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => onOpenAnnotation(selectedRecord)}
                    >
                      <LocateFixed size={14} aria-hidden="true" />
                      跳到原文
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 overflow-auto px-4 py-4">
                {!selectedRecord ? (
                  <ReaderEmptyState
                    className="min-h-full"
                    description="从左侧选择批注后，可以查看上下文、编辑内容并跳回原文。"
                    icon={MessageSquareText}
                    title="选择一条批注"
                  />
                ) : (
                  <div className="grid gap-3">
                    <section className="rounded-lg border bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <AnnotationTypeBadge label={annotationDisplayLabel(selectedRecord.annotation)} />
                          <ImportanceBadge importance={selectedRecord.annotation.importance} />
                          {selectedRecord.segment_status !== 'current' ? (
                            <Badge variant="destructive">片段失联</Badge>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatDate(selectedRecord.annotation.updated_at)}
                        </span>
                      </div>

                      {selectedRecord.annotation.content.trim() ? (
                        <div className="mt-3 grid gap-1">
                          <span className="text-xs font-medium text-muted-foreground">批注内容</span>
                          <div className="rounded-md border bg-muted/15 px-3 py-2 text-sm leading-6 text-foreground">
                            {selectedRecord.annotation.content}
                          </div>
                        </div>
                      ) : null}
                      {selectedRecord.annotation.text_selection?.text ? (
                        <div className="mt-3 grid gap-1">
                          <span className="text-xs font-medium text-muted-foreground">选中文字</span>
                          <div className="rounded-md border-l-2 border-amber-300 bg-amber-50/70 px-3 py-2 text-sm leading-6 text-foreground">
                            {selectedRecord.annotation.text_selection.text}
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <section className="rounded-lg border bg-muted/15 p-3">
                      <div className="grid gap-3 text-sm text-foreground">
                        <div className="grid gap-1">
                          <span className="text-xs font-medium text-muted-foreground">来源</span>
                          <div className="font-medium">{selectedRecord.entry_title}</div>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-xs font-medium text-muted-foreground">原文</span>
                          <div className="rounded-md border bg-white px-3 py-2 text-sm leading-6 text-foreground">
                            {sourcePreview(selectedRecord)}
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-xs font-medium text-muted-foreground">相关信息</span>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatSegmentLabel(selectedRecord)}</span>
                            <span>{selectedRecord.annotation.annotation_id.slice(0, 8)}</span>
                            <TagBadges tags={selectedTagNames} />
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                )}
              </div>

              <div className="flex min-w-0 items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {selectedRecord
                    ? `${selectedRecord.annotation.annotation_id.slice(0, 8)} · ${formatDate(
                        selectedRecord.annotation.updated_at
                      )}`
                    : '请选择一条批注'}
                </span>

              </div>
            </div>
          </div>
        </Card>
      </div>
  );

  if (standalone) {
    return <div className="h-full min-h-0 overflow-hidden">{content}</div>;
  }

  return (
    <TabsContent className="m-0 h-full min-h-0" value="library">
      {content}
    </TabsContent>
  );
}

function filterAnnotations({
  activeTagIds,
  annotations,
  importanceFilter,
  kindFilter,
  query,
  sortBy,
  tagPathById
}: {
  activeTagIds: Set<string> | null;
  annotations: AnnotationCatalogRecord[];
  importanceFilter: ImportanceFilter;
  kindFilter: KindFilter;
  query: string;
  sortBy: string;
  tagPathById: Map<string, string>;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = annotations.filter((record) => {
    if (activeTagIds && !record.entry_tag_ids.some((tagId) => activeTagIds.has(tagId))) {
      return false;
    }
    if (kindFilter !== 'all' && record.annotation.kind !== kindFilter) {
      return false;
    }
    if (importanceFilter !== 'all' && record.annotation.importance !== importanceFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    const tagText = record.entry_tag_ids
      .map((tagId) => tagPathById.get(tagId) ?? tagId)
      .join(' ');
    const haystack = [
      record.annotation.content,
      annotationKindLabel(record.annotation.kind),
      record.annotation.importance,
      record.entry_title,
      tagText,
      sourcePreview(record)
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return [...filtered].sort((left, right) => {
    if (sortBy === 'importance') {
      return (
        annotationImportanceRank(right.annotation.importance) -
        annotationImportanceRank(left.annotation.importance)
      );
    }
    if (sortBy === 'entry') {
      return left.entry_title.localeCompare(right.entry_title);
    }
    if (sortBy === 'page') {
      return (left.segment?.page_idx ?? Number.MAX_SAFE_INTEGER) - (right.segment?.page_idx ?? Number.MAX_SAFE_INTEGER);
    }
    return new Date(right.annotation.updated_at).getTime() - new Date(left.annotation.updated_at).getTime();
  });
}

function formatSegmentLabel(record: AnnotationCatalogRecord) {
  if (record.segment) {
    return `${segmentTypeLabel(record.segment.segment_type)} · ${pageLabel(record.segment.page_idx)}`;
  }
  return `Segment ${record.annotation.segment_uid.slice(0, 8)}`;
}

function sourcePreview(record: AnnotationCatalogRecord) {
  const source = record.segment?.markdown ?? record.segment?.text ?? '';
  return source.replace(/\s+/g, ' ').trim() || '暂无原文预览';
}

function AnnotationTypeBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
      {label}
    </span>
  );
}

function annotationDisplayLabel(annotation: Annotation) {
  if (annotation.text_selection) {
    return annotation.content.trim() ? '选区批注' : '高亮';
  }
  return annotationKindLabel(annotation.kind);
}

function ImportanceBadge({ importance }: { importance: AnnotationImportance }) {
  const rank = annotationImportanceRank(importance);

  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/50 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
      {annotationImportanceLabel(importance)}
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3].map((item) => (
          <Star
            className={item <= rank ? 'fill-current' : 'text-amber-300/40'}
            key={item}
            size={10}
            aria-hidden="true"
          />
        ))}
      </span>
    </span>
  );
}
