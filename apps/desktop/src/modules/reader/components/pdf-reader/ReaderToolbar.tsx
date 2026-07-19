import {
  Download,
  Eye,
  ListChecks,
  Loader2,
  Pause,
  Sparkles,
  RotateCcw,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import type { EntryTranslation } from '@/shared/ipc/workspaceApi';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { TagRecommendation } from '@/shared/ipc/assistantApi';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import { StatusBadge } from '../EntryDisplay';
import { EntryContentHeader } from '../EntryContentHeader';

export function ReaderToolbar({
  entry,
  pageCount,
  segmentCount,
  recommendedTags,
  selectedRecommendedTagPaths,
  tagSuggestionBusy,
  tagSuggestionsOpen,
  hasRetryableFailures,
  translation,
  translationBusy,
  zoom,
  readerPreferences,
  onApplyRecommendedTags,
  onDismissRecommendedTags,
  onRecommendedTagToggle,
  onTagSuggestionsOpenChange,
  onExportTranslation,
  onPauseTranslation,
  onRetryFailedTranslation,
  onOpenTranslationTask,
  onReaderPreferencesChange,
  onZoomIn,
  onZoomOut
}: {
  entry: LibraryEntry;
  pageCount: number;
  segmentCount: number;
  recommendedTags: TagRecommendation[];
  selectedRecommendedTagPaths: string[];
  tagSuggestionBusy: boolean;
  tagSuggestionsOpen: boolean;
  hasRetryableFailures: boolean;
  translation: EntryTranslation | null;
  translationBusy: boolean;
  zoom: number;
  readerPreferences: ReaderPreferences;
  onApplyRecommendedTags: () => void;
  onDismissRecommendedTags: () => void;
  onRecommendedTagToggle: (tag: TagRecommendation) => void;
  onTagSuggestionsOpenChange: (open: boolean) => void;
  onExportTranslation: () => void;
  onPauseTranslation: () => void;
  onRetryFailedTranslation: () => void;
  onOpenTranslationTask: () => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const hasTranslation = Boolean(
    translation?.segments.some((segment) => segment.status === 'translated')
  );
  return (
    <div className="border-b bg-background">
      <EntryContentHeader
        className="border-b-0"
        contentTitle="PDF 内容"
        entryTitle={entry.title}
      >
        {translationBusy ? (
          <Button className="shrink-0" size="sm" type="button" variant="outline" onClick={onPauseTranslation}>
            <Pause size={14} aria-hidden="true" />
            暂停
          </Button>
        ) : null}

        {!translationBusy && hasRetryableFailures ? (
          <Button className="shrink-0" size="sm" type="button" variant="outline" onClick={onRetryFailedTranslation}>
            <RotateCcw size={14} aria-hidden="true" />
            重试失败
          </Button>
        ) : null}

        {!translationBusy && hasTranslation ? (
          <Button className="shrink-0" size="sm" type="button" variant="outline" onClick={onExportTranslation}>
            <Download size={14} aria-hidden="true" />
            导出
          </Button>
        ) : null}

        {entry.status === 'Parsed' ? (
          <Button
            className="shrink-0"
            size="sm"
            type="button"
            variant={translationBusy ? 'secondary' : 'outline'}
            onClick={onOpenTranslationTask}
          >
            <ListChecks size={14} aria-hidden="true" />
            {translationBusy ? '翻译任务进行中' : '翻译任务'}
          </Button>
        ) : null}

        {entry.status === 'Parsed' && recommendedTags.length > 0 ? (
          <RecommendedTagControls
            busy={tagSuggestionBusy}
            open={tagSuggestionsOpen}
            recommendedTags={recommendedTags}
            selectedRecommendedTagPaths={selectedRecommendedTagPaths}
            onApply={onApplyRecommendedTags}
            onDismiss={onDismissRecommendedTags}
            onOpenChange={onTagSuggestionsOpenChange}
            onToggleTag={onRecommendedTagToggle}
          />
        ) : null}

        <HoverPreviewControls
          preferences={readerPreferences}
          onChange={onReaderPreferencesChange}
        />

        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon-sm" title="缩小" type="button" variant="outline" onClick={onZoomOut}>
            <ZoomOut size={14} aria-hidden="true" />
          </Button>
          <span className="w-12 text-center text-xs font-semibold text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button size="icon-sm" title="放大" type="button" variant="outline" onClick={onZoomIn}>
            <ZoomIn size={14} aria-hidden="true" />
          </Button>
        </div>
      </EntryContentHeader>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground">
        {entry.pdfFileName ? (
          <span className="max-w-full truncate font-medium text-foreground" title={entry.pdfFileName}>
            {entry.pdfFileName}
          </span>
        ) : null}
        <span>{segmentCount} 个区域</span>
        <span aria-hidden="true" className="text-muted-foreground/50">·</span>
        <span>{pageCount} 页</span>
        <span aria-hidden="true" className="text-muted-foreground/50">·</span>
        <StatusBadge status={entry.status} />
      </div>
    </div>
  );
}

function RecommendedTagControls({
  busy,
  open,
  recommendedTags,
  selectedRecommendedTagPaths,
  onApply,
  onDismiss,
  onOpenChange,
  onToggleTag
}: {
  busy: boolean;
  open: boolean;
  recommendedTags: TagRecommendation[];
  selectedRecommendedTagPaths: string[];
  onApply: () => void;
  onDismiss: () => void;
  onOpenChange: (open: boolean) => void;
  onToggleTag: (tag: TagRecommendation) => void;
}) {
  const selected = new Set(selectedRecommendedTagPaths);
  const selectedCount = selected.size;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          className="shrink-0"
          size="sm"
          type="button"
          variant={open ? 'secondary' : 'outline'}
        >
          <Sparkles size={14} aria-hidden="true" />
          推荐标签
          <Badge variant="outline">{recommendedTags.length}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[24rem] p-3" side="bottom" sideOffset={8}>
        <div className="grid gap-3">
          <div>
            <p className="font-medium">解析完成后的推荐标签</p>
            <p className="mt-1 text-xs text-muted-foreground">先保留有用的，再保存到当前条目。</p>
          </div>

          <div className="grid gap-2">
            {recommendedTags.map((tag) => {
              const active = selected.has(tag.path);
              return (
                <Button
                  key={tag.path}
                  className="h-auto justify-between px-3 py-2 text-left"
                  size="sm"
                  type="button"
                  variant={active ? 'secondary' : 'outline'}
                  onClick={() => onToggleTag(tag)}
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate">{tag.path}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {tag.dimension} · {tag.reason}
                    </span>
                  </span>
                  <Badge variant="outline">{Math.round(tag.confidence * 100)}%</Badge>
                </Button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              disabled={busy}
              size="sm"
              type="button"
              variant="ghost"
              onClick={onDismiss}
            >
              关闭
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                已选 {selectedCount} 项
              </span>
              <Button
                disabled={busy || selectedCount === 0}
                size="sm"
                type="button"
                variant="default"
                onClick={onApply}
              >
                {busy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : null}
                保存推荐
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function HoverPreviewControls({
  preferences,
  onChange,
  mode = 'pdf'
}: {
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
  mode?: 'pdf' | 'reflow';
}) {
  const [expanded, setExpanded] = useState(false);
  const enabled =
    mode === 'pdf'
      ? preferences.hoverPreviewEnabled
      : preferences.reflowHoverSourceEnabled;
  const update = (changes: Partial<ReaderPreferences>) => {
    onChange({ ...preferences, ...changes });
  };

  return (
    <Popover open={expanded} onOpenChange={setExpanded}>
      <PopoverTrigger asChild>
        <Button
          className="shrink-0"
          aria-pressed={enabled}
          size="sm"
          title="悬停配置"
          type="button"
          variant={enabled ? 'secondary' : 'outline'}
        >
          <Eye size={14} aria-hidden="true" />
          悬停配置
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 gap-0 p-2.5 duration-0"
        side="bottom"
        sideOffset={8}
      >
        <div
          aria-label="悬停配置"
          role="dialog"
        >
          <div className="mb-2">
            <p className="font-medium">悬停配置</p>
            <p className="mt-0.5 text-xs text-muted-foreground">设置会同步保存到阅读偏好。</p>
          </div>
          <div className="grid gap-2">
        <HoverPreviewToggle
          checked={enabled}
          label="启用悬停预览"
          onClick={() =>
            update(
              mode === 'pdf'
                ? { hoverPreviewEnabled: !enabled }
                : { reflowHoverSourceEnabled: !enabled }
            )
          }
        />
        <div className="mt-2 grid gap-1 border-t pt-2">
          {mode === 'pdf' ? (
            <HoverPreviewToggle
              checked={preferences.hoverPreviewShowRegion}
              disabled={!enabled}
              label="区域"
              onClick={() => update({ hoverPreviewShowRegion: !preferences.hoverPreviewShowRegion })}
            />
          ) : null}
          <HoverPreviewToggle
            checked={preferences.hoverPreviewShowOriginal}
            disabled={!enabled}
            label="解析后"
            onClick={() => update({ hoverPreviewShowOriginal: !preferences.hoverPreviewShowOriginal })}
          />
          <HoverPreviewToggle
            checked={preferences.hoverPreviewShowTranslation}
            disabled={!enabled}
            label="翻译"
            onClick={() => update({ hoverPreviewShowTranslation: !preferences.hoverPreviewShowTranslation })}
          />
          <HoverPreviewToggle
            checked={preferences.hoverPreviewShowNote}
            disabled={!enabled}
            label="片段笔记"
            onClick={() => update({ hoverPreviewShowNote: !preferences.hoverPreviewShowNote })}
          />
          <HoverPreviewToggle
            checked={preferences.hoverPreviewShowAnnotation}
            disabled={!enabled}
            label="批注"
            onClick={() => update({ hoverPreviewShowAnnotation: !preferences.hoverPreviewShowAnnotation })}
          />
        </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HoverPreviewToggle({
  checked,
  disabled = false,
  label,
  onClick
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <label className="flex min-h-8 items-center justify-between rounded-md px-2 text-sm hover:bg-muted has-[:disabled]:opacity-50">
      <span>{label}</span>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onClick}
      />
    </label>
  );
}
