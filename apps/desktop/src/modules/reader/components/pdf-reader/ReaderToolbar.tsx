import {
  Columns2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  ExternalLink,
  FolderOpen,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Sparkles,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { EntryTranslation } from '@/shared/ipc/workspaceApi';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { TagRecommendation } from '@/shared/ipc/assistantApi';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import { StatusBadge } from '../EntryDisplay';
import { EntryContentHeader } from '../EntryContentHeader';
import { useReadingSession } from '../../parallel-reading/ReadingSessionContext';
import { PdfReadingModeControl } from './PdfReadingModeControl';

export function ReaderToolbar({
  navigation,
  entry,
  pageCount,
  segmentCount,
  recommendedTags,
  selectedRecommendedTagPaths,
  tagSuggestionBusy,
  tagSuggestionError,
  tagSuggestionsOpen,
  translation,
  translationBusy,
  translationMessage,
  zoom,
  readerPreferences,
  currentPage = 1,
  effectivePageDisplayMode,
  searchActiveMatchNumber = 0,
  searchMatchCount = 0,
  searchQuery = '',
  searchStatus = 'idle',
  onApplyRecommendedTags,
  onDismissRecommendedTags,
  onRecommendedTagToggle,
  onTagSuggestionsOpenChange,
  onExportTranslation,
  onExportPaper,
  onPauseTranslation,
  onOpenTranslationTask,
  onReaderPreferencesChange,
  onCurrentPageChange,
  onOpenPdf,
  onReparsePdf,
  onRetryPdfParse,
  onRevealPdf,
  onSearchNext,
  onSearchPrevious,
  onSearchQueryChange,
  onStartPdfParse,
  reparseBusy = false,
  onZoomIn,
  onZoomOut
}: {
  navigation?: import('react').ReactNode;
  entry: LibraryEntry;
  pageCount: number;
  segmentCount: number;
  recommendedTags: TagRecommendation[];
  selectedRecommendedTagPaths: string[];
  tagSuggestionBusy: boolean;
  tagSuggestionError?: string | null;
  tagSuggestionsOpen: boolean;
  translation: EntryTranslation | null;
  translationBusy: boolean;
  translationMessage?: string | null;
  zoom: number;
  readerPreferences: ReaderPreferences;
  currentPage?: number;
  effectivePageDisplayMode?: 'single' | 'dual';
  searchActiveMatchNumber?: number;
  searchMatchCount?: number;
  searchQuery?: string;
  searchStatus?: 'idle' | 'searching' | 'ready' | 'error';
  onApplyRecommendedTags: () => void;
  onDismissRecommendedTags: () => void;
  onRecommendedTagToggle: (tag: TagRecommendation) => void;
  onTagSuggestionsOpenChange: (open: boolean) => void;
  onExportTranslation: () => void;
  onExportPaper?: () => void;
  onPauseTranslation: () => void;
  onOpenTranslationTask: () => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onCurrentPageChange?: (pageNumber: number) => void;
  onOpenPdf?: () => void;
  onReparsePdf?: () => void;
  onRetryPdfParse?: () => void;
  onRevealPdf?: () => void;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  onSearchQueryChange?: (query: string) => void;
  onStartPdfParse?: () => void;
  reparseBusy?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const readingSession = useReadingSession();
  const hasTranslation = Boolean(
    translation?.segments.some((segment) => segment.status === 'translated')
  );
  const pageNavigation = <>{navigation}<PageNavigationControls currentPage={currentPage} pageCount={pageCount}
    pageStep={(effectivePageDisplayMode ?? readerPreferences.pageDisplayMode) === 'dual' ? 2 : 1} onCurrentPageChange={onCurrentPageChange} /></>;
  const searchControls = <PdfSearchControls activeMatchNumber={searchActiveMatchNumber} matchCount={searchMatchCount}
    query={searchQuery} status={searchStatus} onNext={onSearchNext} onPrevious={onSearchPrevious} onQueryChange={onSearchQueryChange} />;
  const overflowMenu = (compact = false) => <ReaderToolbarOverflowMenu compact={compact} hasTranslation={hasTranslation}
    parseStatus={entry.status} parsed={entry.status === 'Parsed'} reparseBusy={reparseBusy} translationBusy={translationBusy}
    onExportTranslation={onExportTranslation} onExportPaper={segmentCount > 0 ? onExportPaper : undefined}
    onOpenPdf={onOpenPdf} onOpenTranslationTask={onOpenTranslationTask} onPauseTranslation={onPauseTranslation}
    onReparsePdf={onReparsePdf} onRetryPdfParse={onRetryPdfParse} onRevealPdf={onRevealPdf} onStartPdfParse={onStartPdfParse} />;

  // The parallel-reading frame already owns the title and PDF/reflow switch.
  if (readingSession) return <div aria-label="PDF 阅读工具" data-reader-compact-toolbar className="flex min-h-9 min-w-0 shrink-0 flex-wrap items-center gap-1 border-b bg-background px-2 py-1 text-xs">
    {pageNavigation}
    <div className="min-w-0 flex-1" />
    <PdfReadingModeControl preferences={readerPreferences} onChange={onReaderPreferencesChange} />
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="outline" className="px-2 text-xs" aria-label="缩放与阅读显示" title="调整缩放、单页/双页与悬停预览">{Math.round(zoom * 100)}%</Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-72 max-w-[calc(100vw-2rem)] space-y-3 text-xs">
        <div className="flex items-center justify-between gap-2"><span>PDF 缩放</span><div className="flex items-center gap-2">
          <Button size="icon-sm" variant="outline" aria-label="缩小" title="缩小" onClick={onZoomOut}><ZoomOut size={14} aria-hidden="true" /></Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button size="icon-sm" variant="outline" aria-label="放大" title="放大" onClick={onZoomIn}><ZoomIn size={14} aria-hidden="true" /></Button>
        </div></div>
        <Button size="sm" variant="outline" onClick={() => onReaderPreferencesChange({ ...readerPreferences, pageDisplayMode: readerPreferences.pageDisplayMode === 'dual' ? 'single' : 'dual' })}>
          {readerPreferences.pageDisplayMode === 'dual' ? '切换为单页' : '切换为双页'}
        </Button>
        <HoverPreviewControls preferences={readerPreferences} onChange={onReaderPreferencesChange} />
        {entry.status === 'Parsed' && recommendedTags.length > 0 ? <RecommendedTagControls busy={tagSuggestionBusy} open={tagSuggestionsOpen}
          error={tagSuggestionError} appliedPaths={entry.tags}
          recommendedTags={recommendedTags} selectedRecommendedTagPaths={selectedRecommendedTagPaths} onApply={onApplyRecommendedTags}
          onDismiss={onDismissRecommendedTags} onOpenChange={onTagSuggestionsOpenChange} onToggleTag={onRecommendedTagToggle} /> : null}
        <p className="break-words text-muted-foreground">{entry.pdfFileName} · {segmentCount} 个区域</p>
        <StatusBadge status={entry.status} />
      </PopoverContent>
    </Popover>
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant={searchQuery ? 'secondary' : 'outline'} className="px-2 text-xs" aria-label="查找 PDF 文字" title="查找当前 PDF 中的文字">查找</Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3"><p className="text-xs font-medium">查找当前 PDF</p>{searchControls}</PopoverContent>
    </Popover>
    {overflowMenu(true)}
    {translationBusy ? <span className="sr-only" role="status">{translationMessage || '正在翻译'}</span> : null}
  </div>;
  return (
    <div className="pdf-reader-toolbar border-b bg-background">
      <EntryContentHeader
        className="border-b-0"
        contentTitle="PDF 内容"
        entryTitle={entry.title}
      >
        {translationBusy ? (
          <ToolbarTooltip content="暂停当前翻译任务">
          <Button aria-label="暂停翻译" className="pdf-reader-toolbar-overflow-action shrink-0" size="sm" type="button" variant="outline" onClick={onPauseTranslation}>
            <Pause size={14} aria-hidden="true" />
            <span className="pdf-reader-toolbar-label">暂停</span>
          </Button>
          </ToolbarTooltip>
        ) : null}

        {onExportPaper && segmentCount > 0 ? (
          <ToolbarTooltip content="导出解析全文、中文译稿或中英对照，支持 Word、TXT 和图片资料包">
            <Button aria-label="导出论文内容" className="pdf-reader-toolbar-overflow-action shrink-0" size="sm" type="button" variant="outline" onClick={onExportPaper}>
              <Download size={14} aria-hidden="true" /><span className="pdf-reader-toolbar-label">导出</span>
            </Button>
          </ToolbarTooltip>
        ) : null}
        {!onExportPaper && !translationBusy && hasTranslation ? (
          <ToolbarTooltip content="导出当前条目的译文笔记">
          <Button aria-label="导出译文笔记" className="pdf-reader-toolbar-overflow-action shrink-0" size="sm" type="button" variant="outline" onClick={onExportTranslation}>
            <Download size={14} aria-hidden="true" />
            <span className="pdf-reader-toolbar-label">导出</span>
          </Button>
          </ToolbarTooltip>
        ) : null}

        {translationBusy ? (
          <span
            aria-live="polite"
            className="pdf-reader-translation-status min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span className="truncate">{translationMessage || '正在翻译'}</span>
          </span>
        ) : null}

        {entry.status === 'Parsed' ? (
          <ToolbarTooltip content="打开翻译任务，选择片段并开始或继续翻译">
          <Button
            aria-label={translationBusy ? '翻译任务进行中' : '翻译任务'}
            className="pdf-reader-toolbar-overflow-action shrink-0"
            size="sm"
            type="button"
            variant={translationBusy ? 'secondary' : 'outline'}
            onClick={onOpenTranslationTask}
          >
            <ListChecks size={14} aria-hidden="true" />
            <span className="pdf-reader-toolbar-label">
              {translationBusy ? '翻译任务进行中' : '翻译任务'}
            </span>
          </Button>
          </ToolbarTooltip>
        ) : null}

        {entry.status === 'Parsed' && onReparsePdf ? (
          <ToolbarTooltip content="重新调用解析服务，生成并覆盖当前 PDF 的解析结果">
          <Button
            aria-label="重新解析 PDF"
            className="pdf-reader-toolbar-overflow-action shrink-0"
            disabled={reparseBusy}
            size="sm"
            type="button"
            variant="outline"
            onClick={onReparsePdf}
          >
            {reparseBusy ? (
              <Loader2 className="animate-spin" size={14} aria-hidden="true" />
            ) : (
              <RotateCcw size={14} aria-hidden="true" />
            )}
            <span className="pdf-reader-toolbar-label">重新解析</span>
          </Button>
          </ToolbarTooltip>
        ) : null}

        {entry.status === 'Queued' && onStartPdfParse ? (
          <ToolbarTooltip content="原 PDF 已可阅读；开始解析后将增加片段、重排和证据能力">
            <Button
              aria-label="开始解析 PDF"
              className="pdf-reader-toolbar-overflow-action shrink-0"
              disabled={reparseBusy}
              size="sm"
              type="button"
              variant="outline"
              onClick={onStartPdfParse}
            >
              {reparseBusy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              <span className="pdf-reader-toolbar-label">开始解析</span>
            </Button>
          </ToolbarTooltip>
        ) : null}

        {entry.status === 'Failed' && onRetryPdfParse ? (
          <ToolbarTooltip content="原 PDF 仍可阅读；重新提交解析以恢复结构化内容">
            <Button
              aria-label="重试解析 PDF"
              className="pdf-reader-toolbar-overflow-action shrink-0"
              disabled={reparseBusy}
              size="sm"
              type="button"
              variant="outline"
              onClick={onRetryPdfParse}
            >
              {reparseBusy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
              <span className="pdf-reader-toolbar-label">重试解析</span>
            </Button>
          </ToolbarTooltip>
        ) : null}

        {entry.status === 'Parsed' && recommendedTags.length > 0 ? (
          <RecommendedTagControls
            error={tagSuggestionError}
            appliedPaths={entry.tags}
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

        {overflowMenu()}

        <PdfReadingModeControl preferences={readerPreferences} onChange={onReaderPreferencesChange} />

        <Button
          className="shrink-0"
          aria-label={readerPreferences.pageDisplayMode === 'dual' ? '切换为单页' : '切换为双页'}
          size="icon-sm"
          title={readerPreferences.pageDisplayMode === 'dual' ? '切换为单页' : '切换为双页'}
          type="button"
          variant={readerPreferences.pageDisplayMode === 'dual' ? 'secondary' : 'outline'}
          onClick={() =>
            onReaderPreferencesChange({
              ...readerPreferences,
              pageDisplayMode:
                readerPreferences.pageDisplayMode === 'dual' ? 'single' : 'dual',
            })
          }
        >
          <Columns2 size={14} aria-hidden="true" />
        </Button>

        <div className="flex shrink-0 items-center gap-1">
          <Button aria-label="缩小" size="icon-sm" title="缩小" type="button" variant="outline" onClick={onZoomOut}>
            <ZoomOut size={14} aria-hidden="true" />
          </Button>
          <span className="pdf-reader-zoom-value w-12 text-center text-xs font-semibold text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button aria-label="放大" size="icon-sm" title="放大" type="button" variant="outline" onClick={onZoomIn}>
            <ZoomIn size={14} aria-hidden="true" />
          </Button>
        </div>
      </EntryContentHeader>

      <div data-material="reader-toolbar-row" className="flex min-w-0 flex-wrap items-center gap-2 border-t bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {entry.pdfFileName ? (
            <span className="min-w-0 truncate font-medium text-foreground" title={entry.pdfFileName}>
              {entry.pdfFileName}
            </span>
          ) : null}
          <span className="shrink-0">{segmentCount} 个区域</span>
          <StatusBadge status={entry.status} />
        </div>

        {pageNavigation}
        {searchControls}
      </div>
    </div>
  );
}

function ToolbarTooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>{content}</TooltipContent>
    </Tooltip>
  );
}

function ReaderToolbarOverflowMenu({
  compact = false,
  hasTranslation,
  parseStatus,
  parsed,
  reparseBusy,
  translationBusy,
  onExportTranslation,
  onExportPaper,
  onOpenPdf,
  onOpenTranslationTask,
  onPauseTranslation,
  onReparsePdf,
  onRetryPdfParse,
  onRevealPdf,
  onStartPdfParse
}: {
  compact?: boolean;
  hasTranslation: boolean;
  parseStatus: LibraryEntry['status'];
  parsed: boolean;
  reparseBusy: boolean;
  translationBusy: boolean;
  onExportTranslation: () => void;
  onExportPaper?: () => void;
  onOpenPdf?: () => void;
  onOpenTranslationTask: () => void;
  onPauseTranslation: () => void;
  onReparsePdf?: () => void;
  onRetryPdfParse?: () => void;
  onRevealPdf?: () => void;
  onStartPdfParse?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="更多 PDF 操作"
          className={compact ? 'shrink-0 px-2 text-xs' : 'pdf-reader-toolbar-overflow shrink-0'}
          size={compact ? 'sm' : 'icon-sm'}
          title="更多 PDF 操作"
          type="button"
          variant={compact && translationBusy ? 'secondary' : 'outline'}
        >
          {compact ? translationBusy ? '翻译中' : '工具' : <MoreHorizontal size={14} aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent viewportAligned align="end">
        {translationBusy ? (
          <DropdownMenuItem onSelect={onPauseTranslation}>
            <Pause size={14} aria-hidden="true" />
            暂停翻译
          </DropdownMenuItem>
        ) : null}
        {onExportPaper ? <DropdownMenuItem onSelect={onExportPaper}>
          <Download size={14} aria-hidden="true" />导出论文内容
        </DropdownMenuItem> : null}
        {!translationBusy && hasTranslation ? (
          <DropdownMenuItem onSelect={onExportTranslation}>
            <Download size={14} aria-hidden="true" />
            {onExportPaper ? <span>生成内部译文笔记<span className="block text-xs text-muted-foreground">仅包含已翻译片段</span></span> : '导出译文笔记'}
          </DropdownMenuItem>
        ) : null}
        {parsed ? (
          <DropdownMenuItem onSelect={onOpenTranslationTask}>
            <ListChecks size={14} aria-hidden="true" />
            {translationBusy ? '查看翻译任务' : '打开翻译任务'}
          </DropdownMenuItem>
        ) : null}
        {parsed && onReparsePdf ? (
          <DropdownMenuItem disabled={reparseBusy} onSelect={onReparsePdf}>
            {reparseBusy ? (
              <Loader2 className="animate-spin" size={14} aria-hidden="true" />
            ) : (
              <RotateCcw size={14} aria-hidden="true" />
            )}
            重新解析 PDF
          </DropdownMenuItem>
        ) : null}
        {parseStatus === 'Queued' && onStartPdfParse ? (
          <DropdownMenuItem disabled={reparseBusy} onSelect={onStartPdfParse}>
            <Play size={14} aria-hidden="true" />
            开始解析 PDF
          </DropdownMenuItem>
        ) : null}
        {parseStatus === 'Failed' && onRetryPdfParse ? (
          <DropdownMenuItem disabled={reparseBusy} onSelect={onRetryPdfParse}>
            <RotateCcw size={14} aria-hidden="true" />
            重试解析 PDF
          </DropdownMenuItem>
        ) : null}
        {(onOpenPdf || onRevealPdf) ? <DropdownMenuSeparator /> : null}
        {onOpenPdf ? (
          <DropdownMenuItem onSelect={onOpenPdf}>
            <ExternalLink size={14} aria-hidden="true" />
            使用系统打开原 PDF
          </DropdownMenuItem>
        ) : null}
        {onRevealPdf ? (
          <DropdownMenuItem onSelect={onRevealPdf}>
            <FolderOpen size={14} aria-hidden="true" />
            在文件夹中显示
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PageNavigationControls({
  currentPage,
  pageCount,
  pageStep,
  onCurrentPageChange
}: {
  currentPage: number;
  pageCount: number;
  pageStep: 1 | 2;
  onCurrentPageChange?: (pageNumber: number) => void;
}) {
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  useEffect(() => setPageDraft(String(currentPage)), [currentPage]);

  const parsedDraftPage = Number.parseInt(pageDraft, 10);
  const navigationPage = Number.isFinite(parsedDraftPage)
    ? Math.min(pageCount, Math.max(1, parsedDraftPage))
    : currentPage;
  const spreadStartPage = Math.floor((navigationPage - 1) / pageStep) * pageStep + 1;
  const requestPage = (pageNumber: number) => {
    const clampedPage = Math.min(pageCount, Math.max(1, pageNumber));
    setPageDraft(String(clampedPage));
    onCurrentPageChange?.(clampedPage);
  };

  const commitPage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPage = Number.parseInt(pageDraft, 10);
    if (!Number.isFinite(nextPage)) {
      setPageDraft(String(currentPage));
      return;
    }
    requestPage(nextPage);
  };

  return (
    <form aria-label="PDF 页码导航" className="flex shrink-0 items-center gap-1" onSubmit={commitPage}>
      <Button
        aria-label="上一页"
        disabled={currentPage <= 1}
        size="icon-xs"
        title="上一页"
        type="button"
        variant="outline"
        onClick={() => requestPage(spreadStartPage - pageStep)}
      >
        <ChevronLeft size={13} aria-hidden="true" />
      </Button>
      <Input
        aria-label="当前页码"
        className="h-6 w-9 px-1 text-center text-xs tabular-nums"
        autoComplete="off"
        inputMode="numeric"
        pattern="[0-9]*"
        type="text"
        value={pageDraft}
        onBlur={() => {
          const nextPage = Number.parseInt(pageDraft, 10);
          if (Number.isFinite(nextPage) && pageDraft !== String(currentPage)) {
            requestPage(nextPage);
          } else if (!Number.isFinite(nextPage)) {
            setPageDraft(String(currentPage));
          }
        }}
        onChange={(event) => {
          const nextDraft = event.target.value.replace(/\D/g, '');
          setPageDraft(nextDraft);
        }}
      />
      <span className="shrink-0 tabular-nums">/ {pageCount}</span>
      <Button
        aria-label="下一页"
        disabled={spreadStartPage + pageStep > pageCount}
        size="icon-xs"
        title="下一页"
        type="button"
        variant="outline"
        onClick={() => requestPage(spreadStartPage + pageStep)}
      >
        <ChevronRight size={13} aria-hidden="true" />
      </Button>
    </form>
  );
}

function PdfSearchControls({
  activeMatchNumber,
  matchCount,
  query,
  status,
  onNext,
  onPrevious,
  onQueryChange
}: {
  activeMatchNumber: number;
  matchCount: number;
  query: string;
  status: 'idle' | 'searching' | 'ready' | 'error';
  onNext?: () => void;
  onPrevious?: () => void;
  onQueryChange?: (query: string) => void;
}) {
  const hasMatches = matchCount > 0;
  const resultLabel = status === 'searching'
    ? '查找中'
    : query && status === 'ready'
      ? hasMatches
        ? `${activeMatchNumber}/${matchCount}`
        : '无匹配'
      : status === 'error'
        ? '查找失败'
        : '';

  return (
    <form
      aria-label="PDF 文内查找"
      className="ml-auto flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onNext?.();
      }}
    >
      <div className="relative min-w-28 max-w-48 flex-1">
        <Search data-slot="search-input-icon" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={13} aria-hidden="true" />
        <Input
          aria-label="在当前 PDF 中查找"
          className="h-7 w-full pl-7 pr-7 text-xs"
          placeholder="查找文字"
          type="search"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onQueryChange?.('');
            }
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault();
              onPrevious?.();
            }
          }}
        />
        {query ? (
          <Button
            aria-label="清除查找"
            className="absolute right-0.5 top-0.5"
            size="icon-xs"
            title="清除查找"
            type="button"
            variant="ghost"
            onClick={() => onQueryChange?.('')}
          >
            {status === 'searching' ? <Loader2 className="animate-spin" size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
          </Button>
        ) : null}
      </div>
      <span aria-live="polite" className="min-w-12 text-center text-[11px] tabular-nums">
        {resultLabel}
      </span>
      <Button aria-label="上一个匹配" disabled={!hasMatches} size="icon-xs" title="上一个匹配（Shift+Enter）" type="button" variant="outline" onClick={onPrevious}>
        <ChevronUp size={13} aria-hidden="true" />
      </Button>
      <Button aria-label="下一个匹配" disabled={!hasMatches} size="icon-xs" title="下一个匹配（Enter）" type="submit" variant="outline">
        <ChevronDown size={13} aria-hidden="true" />
      </Button>
    </form>
  );
}

function RecommendedTagControls({
  error,
  appliedPaths,
  busy,
  open,
  recommendedTags,
  selectedRecommendedTagPaths,
  onApply,
  onDismiss,
  onOpenChange,
  onToggleTag
}: {
  error?: string | null;
  appliedPaths: string[];
  busy: boolean;
  open: boolean;
  recommendedTags: TagRecommendation[];
  selectedRecommendedTagPaths: string[];
  onApply: () => void;
  onDismiss: () => void;
  onOpenChange: (open: boolean) => void;
  onToggleTag: (tag: TagRecommendation) => void;
}) {
  const selected = new Set(selectedRecommendedTagPaths.filter(path => !appliedPaths.includes(path)));
  const selectedCount = selected.size;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`推荐标签 ${recommendedTags.length} 项`}
          className="shrink-0"
          size="sm"
          title="查看条目概览中生成的推荐标签"
          type="button"
          variant={open ? 'secondary' : 'outline'}
        >
          <Sparkles size={14} aria-hidden="true" />
          <span className="pdf-reader-toolbar-label">推荐标签</span>
          <Badge variant="outline">{recommendedTags.length}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[24rem] p-3" side="bottom" sideOffset={8}>
        <div className="grid gap-3">
          <div>
            <p className="font-medium">推荐标签</p>
            <p className="mt-1 text-xs text-muted-foreground">结果与条目概览同步；需要更新时可在概览中重新生成。</p>
          </div>

          <div className="grid gap-2">
            {recommendedTags.map((tag) => {
              const active = selected.has(tag.path);
              const applied = appliedPaths.includes(tag.path);
              return (
                <Button
                  key={tag.path}
                  className="h-auto justify-between px-3 py-2 text-left"
                  size="sm"
                  type="button"
                  variant={active || applied ? 'secondary' : 'outline'}
                  disabled={busy || applied}
                  aria-pressed={active || applied}
                  onClick={() => onToggleTag(tag)}
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate">{tag.path}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {tag.dimension} · {tag.reason}
                    </span>
                  </span>
                  <Badge variant="outline">{applied ? '已添加' : `${Math.round(tag.confidence * 100)}%`}</Badge>
                </Button>
              );
            })}
          </div>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
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
          aria-label="悬停配置"
          className="shrink-0"
          aria-pressed={enabled}
          size="sm"
          title="配置鼠标悬停片段时显示的原文、译文、笔记和批注"
          type="button"
          variant={enabled ? 'secondary' : 'outline'}
        >
          <Eye size={14} aria-hidden="true" />
          <span className="pdf-reader-toolbar-label">悬停配置</span>
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
