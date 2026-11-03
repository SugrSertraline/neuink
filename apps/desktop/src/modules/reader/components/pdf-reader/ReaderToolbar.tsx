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
  RotateCcw,
  X
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
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
import { PdfViewControls } from '../navigation/ReadingViewSession';
import { PdfZoomControls } from './PdfZoomControls';
import { PdfPreviewSizeControls } from './PdfPreviewSizeControls';
import { RecommendedTagControls } from './RecommendedTagControls';

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
  tagSuggestionDisabledReason,
  tagSuggestionGeneratedAt,
  tagSuggestionPhase,
  showTagSuggestionsInReader = true,
  onGenerateRecommendedTags,
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
  onCancelTranslation,
  onResumeTranslation,
  translationStopPending,
  onOpenTranslationTask,
  onReaderPreferencesChange,
  onCurrentPageChange,
  onOpenPdf,
  onRetryPdfParse,
  onRevealPdf,
  onSearchNext,
  onSearchPrevious,
  onSearchQueryChange,
  onStartPdfParse,
  reparseBusy = false,
  onZoomIn,
  onZoomOut,
  onZoomReset
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
  tagSuggestionDisabledReason?: string | null;
  tagSuggestionGeneratedAt?: string | null;
  tagSuggestionPhase?: 'idle' | 'generating' | 'applying';
  showTagSuggestionsInReader?: boolean;
  onGenerateRecommendedTags?: () => void;
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
  onCancelTranslation?: () => void;
  onResumeTranslation?: () => void;
  translationStopPending?: 'pause' | 'cancel' | 'resume' | null;
  onOpenTranslationTask: () => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onCurrentPageChange?: (pageNumber: number) => void;
  onOpenPdf?: () => void;
  onRetryPdfParse?: () => void;
  onRevealPdf?: () => void;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  onSearchQueryChange?: (query: string) => void;
  onStartPdfParse?: () => void;
  reparseBusy?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}) {
  const readingSession = useReadingSession();
  const translationPaused = !translationBusy && translation?.status === 'paused' && Boolean(translation.task);
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
    onCancelTranslation={onCancelTranslation} translationStopPending={translationStopPending}
    onResumeTranslation={onResumeTranslation} translationPaused={translationPaused}
    onRetryPdfParse={onRetryPdfParse} onRevealPdf={onRevealPdf} onStartPdfParse={onStartPdfParse} />;

  const tagControls = showTagSuggestionsInReader && entry.status === 'Parsed' && (onGenerateRecommendedTags || recommendedTags.length > 0 || tagSuggestionBusy || tagSuggestionError)
    ? <RecommendedTagControls busy={tagSuggestionBusy} open={tagSuggestionsOpen} error={tagSuggestionError} appliedPaths={entry.tags}
      recommendedTags={recommendedTags} selectedRecommendedTagPaths={selectedRecommendedTagPaths} onApply={onApplyRecommendedTags}
      onDismiss={onDismissRecommendedTags} onOpenChange={onTagSuggestionsOpenChange} onToggleTag={onRecommendedTagToggle}
      onGenerate={onGenerateRecommendedTags} disabledReason={tagSuggestionDisabledReason} generatedAt={tagSuggestionGeneratedAt} phase={tagSuggestionPhase} /> : null;

  // The parallel-reading frame already owns the title and PDF/reflow switch.
  if (readingSession) return <div data-guide="pdf-tools" aria-label="PDF 阅读工具" data-reader-compact-toolbar className="flex min-h-9 min-w-0 shrink-0 flex-wrap items-center gap-1 border-b bg-background px-2 py-1 text-xs">
    {pageNavigation}
    <div className="min-w-0 flex-1" />
    <PdfViewControls />
    <PdfReadingModeControl preferences={readerPreferences} onChange={onReaderPreferencesChange} />
    <PdfZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
    {tagControls}
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="outline" className="px-2 text-xs" aria-label="阅读显示" title="调整单页/双页与悬停预览">显示</Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-72 max-w-[calc(100vw-2rem)] space-y-3 text-xs">
        <p className="text-muted-foreground">按住空格并用鼠标左键拖动 PDF；Ctrl＋滚轮可按 1% 缩放。</p>
        <Button size="sm" variant="outline" onClick={() => onReaderPreferencesChange({ ...readerPreferences, pageDisplayMode: readerPreferences.pageDisplayMode === 'dual' ? 'single' : 'dual' })}>
          {readerPreferences.pageDisplayMode === 'dual' ? '切换为单页' : '切换为双页'}
        </Button>
        <HoverPreviewControls preferences={readerPreferences} onChange={onReaderPreferencesChange} />
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
    <div data-guide="pdf-tools" className="pdf-reader-toolbar border-b bg-background">
      <EntryContentHeader
        className="border-b-0"
        contentTitle="PDF 内容"
        entryTitle={entry.title}
      >
        <PdfViewControls />
        {translationBusy ? (
          <ToolbarTooltip content="暂停当前翻译任务">
          <Button disabled={Boolean(translationStopPending)} aria-label="暂停翻译" className="pdf-reader-toolbar-overflow-action shrink-0" size="sm" type="button" variant="outline" onClick={onPauseTranslation}>
            <Pause size={14} aria-hidden="true" />
            <span className="pdf-reader-toolbar-label">暂停</span>
          </Button>
          </ToolbarTooltip>
        ) : null}

        {translationPaused && onResumeTranslation ? <Button disabled={Boolean(translationStopPending)} className="pdf-reader-toolbar-overflow-action shrink-0" size="sm" onClick={onResumeTranslation}><Play size={14} aria-hidden="true" />继续翻译</Button> : null}
        {(translationBusy || translationPaused) && onCancelTranslation ? <Button disabled={Boolean(translationStopPending)} className="pdf-reader-toolbar-overflow-action shrink-0" size="sm" variant="outline" onClick={onCancelTranslation}>取消翻译</Button> : null}

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


        {(entry.status === 'Not started' || entry.status === 'Canceled') && onStartPdfParse ? (
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

        {tagControls}

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

        <PdfZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
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
  onCancelTranslation,
  onResumeTranslation,
  translationPaused,
  translationStopPending,
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
  onCancelTranslation?: () => void;
  onResumeTranslation?: () => void;
  translationPaused: boolean;
  translationStopPending?: 'pause' | 'cancel' | 'resume' | null;
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
          {compact ? translationBusy ? '翻译中' : translationPaused ? '翻译已暂停' : '工具' : <MoreHorizontal size={14} aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent viewportAligned align="end">
        {translationBusy ? (
          <DropdownMenuItem disabled={Boolean(translationStopPending)} onSelect={onPauseTranslation}>
            <Pause size={14} aria-hidden="true" />
            暂停翻译
          </DropdownMenuItem>
        ) : null}
        {translationPaused && onResumeTranslation ? <DropdownMenuItem disabled={Boolean(translationStopPending)} onSelect={onResumeTranslation}><Play size={14} aria-hidden="true" />继续翻译</DropdownMenuItem> : null}
        {(translationBusy || translationPaused) && onCancelTranslation ? <DropdownMenuItem disabled={Boolean(translationStopPending)} onSelect={onCancelTranslation}>取消翻译</DropdownMenuItem> : null}
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
        {(parseStatus === 'Not started' || parseStatus === 'Canceled') && onStartPdfParse ? (
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
  const active = enabled || preferences.paperReferenceHoverEnabled ||
    (mode === 'pdf' && (preferences.inlineAnnotationHoverEnabled || preferences.pdfSentenceHoverEnabled));
  const update = (changes: Partial<ReaderPreferences>) => {
    onChange({ ...preferences, ...changes });
  };

  return (
    <Popover open={expanded} onOpenChange={setExpanded}>
      <PopoverTrigger asChild>
        <Button
          aria-label="悬停配置"
          className="shrink-0"
          aria-pressed={active}
          size="sm"
          title="配置片段、逐句译文与批注悬停"
          type="button"
          variant={active ? 'secondary' : 'outline'}
        >
          <Eye size={14} aria-hidden="true" />
          <span className="pdf-reader-toolbar-label">悬停配置</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto overscroll-contain p-2.5 duration-0"
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
          <div className="grid gap-3">
            <section aria-label={mode === 'pdf' ? 'PDF 片段悬停' : '重排悬停'}>
              <p className="px-2 text-xs font-medium text-muted-foreground">{mode === 'pdf' ? 'PDF 片段' : '重排内容'}</p>
              <HoverPreviewToggle checked={enabled} label="启用悬停预览" onClick={() => update(
                mode === 'pdf' ? { hoverPreviewEnabled: !enabled } : { reflowHoverSourceEnabled: !enabled })} />
              <div className="ml-2 grid gap-0.5 border-l pl-2">
                {mode === 'pdf' ? <HoverPreviewToggle checked={preferences.hoverPreviewShowRegion} disabled={!enabled}
                  label="区域高亮" onClick={() => update({ hoverPreviewShowRegion: !preferences.hoverPreviewShowRegion })} /> : null}
                <HoverPreviewToggle checked={preferences.hoverPreviewShowOriginal} disabled={!enabled}
                  label="解析后原文" onClick={() => update({ hoverPreviewShowOriginal: !preferences.hoverPreviewShowOriginal })} />
                <HoverPreviewToggle checked={preferences.hoverPreviewShowTranslation} disabled={!enabled}
                  label={mode === 'pdf' ? '整段译文' : '译文'}
                  onClick={() => update({ hoverPreviewShowTranslation: !preferences.hoverPreviewShowTranslation })} />
                <HoverPreviewToggle checked={preferences.hoverPreviewShowNote} disabled={!enabled}
                  label="片段笔记" onClick={() => update({ hoverPreviewShowNote: !preferences.hoverPreviewShowNote })} />
                <HoverPreviewToggle checked={preferences.hoverPreviewShowAnnotation} disabled={!enabled}
                  label="悬停批注" onClick={() => update({ hoverPreviewShowAnnotation: !preferences.hoverPreviewShowAnnotation })} />
              </div>
            </section>
            {mode === 'pdf' && <PdfPreviewSizeControls preferences={preferences} onChange={onChange} />}
            {mode === 'pdf' ? <section aria-label="PDF 逐句悬停" className="border-t pt-2">
              <p className="px-2 text-xs font-medium text-muted-foreground">PDF 逐句</p>
              <HoverPreviewToggle checked={preferences.pdfSentenceHoverEnabled} label="整句悬停"
                onClick={() => update({ pdfSentenceHoverEnabled: !preferences.pdfSentenceHoverEnabled })} />
              <div className="ml-2 grid gap-0.5 border-l pl-2">
                <HoverPreviewToggle checked={preferences.pdfSentenceHoverShowOriginal}
                  disabled={!preferences.pdfSentenceHoverEnabled} label="句子原文"
                  onClick={() => update({ pdfSentenceHoverShowOriginal: !preferences.pdfSentenceHoverShowOriginal })} />
                <HoverPreviewToggle checked={preferences.pdfSentenceHoverShowTranslation}
                  disabled={!preferences.pdfSentenceHoverEnabled} label="逐句译文"
                  onClick={() => update({ pdfSentenceHoverShowTranslation: !preferences.pdfSentenceHoverShowTranslation })} />
              </div>
            </section> : null}
            <section aria-label="其他悬停" className="border-t pt-2">
              {mode === 'pdf' ? <HoverPreviewToggle checked={preferences.inlineAnnotationHoverEnabled}
                label="行内批注" onClick={() => update({ inlineAnnotationHoverEnabled: !preferences.inlineAnnotationHoverEnabled })} /> : null}
              <HoverPreviewToggle checked={preferences.paperReferenceHoverEnabled} label="文内引用悬停"
                onClick={() => update({ paperReferenceHoverEnabled: !preferences.paperReferenceHoverEnabled })} />
            </section>
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
