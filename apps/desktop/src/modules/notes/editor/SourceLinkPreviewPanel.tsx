import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ClipboardCopy, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { SourceLinkAttrs, SourceLinkSnapshotAssetContext } from './SourceLinkNode';
import { SourceLinkOriginalPreview } from './SourceLinkOriginalPreview';
import { useNoteSourceStatus } from '../NoteSourcesContext';

export type SourceLinkPreviewMode = 'parsed' | 'original';

export function SourceLinkPreviewPanel({
  attrs, mode, inline, canOpenSource, canDelete, pdfDocument, snapshotAssetContext,
  onModeChange, onClose, onOpenSource, onInline, onCollapseAll, onDelete
}: {
  attrs: SourceLinkAttrs;
  mode: SourceLinkPreviewMode;
  inline: boolean;
  canOpenSource: boolean;
  canDelete: boolean;
  pdfDocument: PDFDocumentProxy | null;
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null;
  onModeChange: (mode: SourceLinkPreviewMode) => void;
  onClose: () => void;
  onOpenSource: () => void;
  onInline: () => void;
  onCollapseAll: () => void;
  onDelete: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const sourceStatus = useNoteSourceStatus(attrs.anchorId);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);
  const text = attrs.snapshotText?.trim() ?? '';
  const title = snapshotAssetContext && snapshotAssetContext.entryId === attrs.sourceEntryId
    ? snapshotAssetContext.entryTitle || '来源文献' : '来源文献';
  const types: Record<string, string> = { paragraph: '段落', title: '标题', table: '表格', image: '图片', figure: '图片', math: '公式', equation: '公式', formula: '公式', code: '代码', list: '列表' };
  const description = [attrs.page ? '第 ' + attrs.page + ' 页' : '页码未知', types[attrs.segmentType ?? ''] ?? '原文片段'].join(' · ');
  const copy = async (citation = false) => {
    const value = citation
      ? [title, description, attrs.displayText, text].filter(Boolean).join('\n')
      : text;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setFeedback(citation ? '引用信息已复制' : '摘录已复制');
    } catch {
      setFeedback('复制失败，请选择文字后按 Ctrl/Cmd+C 复制。');
    }
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(''), 2200);
  };
  return <div className="source-link-preview flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground"
    data-allow-context-menu="true" contentEditable={false}>
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b bg-muted px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold" title={title}>{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{description} · 只读预览</div>
      </div>
      <Button size="xs" variant="ghost" disabled={!canOpenSource} title={canOpenSource ? '在另一侧 PDF 中定位，保留笔记位置' : '来源信息不完整，仍可查看已保存的摘录'} onClick={onOpenSource}>定位原文</Button>
      <Button size="icon-xs" variant="ghost" aria-label={inline ? '收起引用' : '关闭预览'} title={inline ? '收起引用' : '关闭预览（Esc）'} onClick={onClose}><X /></Button>
    </div>
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b bg-popover px-2 py-1">
      <div role="group" aria-label="来源查看方式" className="flex min-w-0 flex-1 gap-1">
        <Button size="xs" variant={mode === 'parsed' ? 'secondary' : 'ghost'} aria-pressed={mode === 'parsed'} onClick={() => onModeChange('parsed')}>文本摘录</Button>
        <Button size="xs" disabled={Boolean(sourceStatus && !sourceStatus.can_locate)} variant={mode === 'original' ? 'secondary' : 'ghost'} aria-pressed={mode === 'original'} onClick={() => onModeChange('original')}>PDF 截图</Button>
      </div>
      <Button size="icon-xs" variant="ghost" aria-label="复制摘录" title="复制摘录" disabled={!text} onClick={() => void copy()}><ClipboardCopy /></Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" aria-label="更多引用操作" title="更多引用操作"><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent viewportAligned align="end" className="z-[var(--z-dialog-popover)] w-52">
          <DropdownMenuItem disabled={!text} onSelect={() => void copy()}>复制摘录</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copy(true)}>复制引用信息</DropdownMenuItem>
          {!inline && <DropdownMenuItem onSelect={onInline}>在正文展开</DropdownMenuItem>}
          <DropdownMenuItem onSelect={onCollapseAll}>收起本笔记全部引用</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>来源详情</DropdownMenuLabel>
          <DropdownMenuLabel className="break-all font-normal" title={attrs.segmentUid ?? undefined}>{attrs.segmentUid || '未保存片段编号'}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={!canDelete} onSelect={onDelete}>移除这条引用</DropdownMenuItem>
          <DropdownMenuLabel className="font-normal">仅移除引用，可用 Ctrl/Cmd+Z 撤销</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {feedback && <div role="status" className="shrink-0 border-b px-2 py-1 text-xs">{feedback}</div>}
    {sourceStatus && sourceStatus.status !== 'available' ? <p role="status" className="shrink-0 border-b px-2 py-1 text-xs text-muted-foreground">{sourceStatus.message}。引用快照仍保留，笔记可继续编辑。</p> : null}
    <div className="source-link-preview-body min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain p-2 text-[13px] leading-relaxed"
      tabIndex={0} role="region" aria-label="来源预览内容">
      {mode === 'original'
        ? <SourceLinkOriginalPreview attrs={attrs} pdfDocument={pdfDocument} snapshotAssetContext={snapshotAssetContext} onShowText={() => onModeChange('parsed')} />
        : text || attrs.snapshotAssetPath
          ? <SourceSnapshotPreview compact imageDetailEnabled imageFillWidth tableDetailEnabled
              markdown={text} previewMode="parsed" relatedImagePath={attrs.snapshotAssetPath}
              segmentType={attrs.segmentType ?? undefined} sourceEntryId={attrs.sourceEntryId}
              workspaceRoot={attrs.workspaceRoot ?? snapshotAssetContext?.workspaceRoot} />
          : <p className="py-3 text-xs text-muted-foreground">未保存文本摘录。可以尝试查看 PDF 截图或定位原文。</p>}
    </div>
  </div>;
}
