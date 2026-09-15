import { FileText, Link2 } from 'lucide-react';

import type { WorkspaceReaderSurfaceKind } from '@/app/workspaceSurfacePairing';
import { Button } from '@/components/ui/button';
import { LocateSourceButton } from './LocateSourceButton';

import type { SourceBacklink } from '../types';
import { EntryContentHeader } from './EntryContentHeader';
import {
  ReaderEmptyState,
  ReaderSurfaceBody
} from './ReaderSurfacePrimitives';

export function SourceLinksSurface({
  backlinks,
  entryTitle,
  linkedReaderKind,
  onOpenEvidence,
  onOpenNote
}: {
  backlinks: SourceBacklink[];
  entryTitle: string;
  linkedReaderKind: WorkspaceReaderSurfaceKind | null;
  onOpenEvidence: (backlink: SourceBacklink) => void;
  onOpenNote: (backlink: SourceBacklink) => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <EntryContentHeader contentTitle="引用此文的笔记" entryTitle={entryTitle} />
      <ReaderSurfaceBody>
        {backlinks.length === 0 ? (
          <ReaderEmptyState
            description="从 PDF 或重排视图把原文片段插入笔记并保存后，引用关系会显示在这里。"
            icon={Link2}
            title="暂无笔记引用"
          />
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            {backlinks.map((backlink) => (
              <article
                className="grid min-w-0 gap-3 border-b p-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={`${backlink.linkId}:${backlink.segmentUid}`}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="min-w-0 truncate text-sm font-semibold text-foreground" title={backlink.noteTitle}>
                      {backlink.noteTitle}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      p.{backlink.page} · {sourceTypeLabel(backlink.segmentType)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground" title={backlink.noteEntryTitle}>
                    {backlink.noteTarget?.owner.kind === 'tag_reading' ? '笔记所属标签：' : '笔记所属条目：'}{backlink.noteEntryTitle}
                  </div>
                  {sourceExcerpt(backlink.snapshotText) ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/80" title={normalizedSourceText(backlink.snapshotText)}>
                      “{sourceExcerpt(backlink.snapshotText)}”
                    </p>
                  ) : null}
                  {backlink.sourceStatus && !backlink.sourceStatus.can_locate ? <p className="mt-1 text-xs text-muted-foreground">{backlink.sourceStatus.message} · 保留引用快照</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                  <Button size="xs" type="button" variant="outline" onClick={() => onOpenNote(backlink)}>
                    <FileText aria-hidden="true" className="size-3.5" />
                    打开笔记
                  </Button>
                  <LocateSourceButton
                    disabled={Boolean(backlink.sourceStatus && !backlink.sourceStatus.can_locate)}
                    label="查看证据"
                    title={linkedReaderKind
                      ? `在配对的${linkedReaderKind === 'pdf' ? ' PDF' : '重排视图'}中定位第 ${backlink.page} 页证据`
                      : `打开原文并定位第 ${backlink.page} 页证据`}
                    onClick={() => onOpenEvidence(backlink)}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </ReaderSurfaceBody>
    </div>
  );
}

function normalizedSourceText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function sourceExcerpt(value: string) {
  const normalized = normalizedSourceText(value);
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
}

function sourceTypeLabel(type: SourceBacklink['segmentType']) {
  const labels: Partial<Record<NonNullable<SourceBacklink['segmentType']>, string>> = {
    code: '代码',
    figure: '图',
    heading: '标题',
    list: '列表',
    math: '公式',
    paragraph: '文本',
    table: '表格'
  };
  return type ? labels[type] ?? '原文片段' : '原文片段';
}
