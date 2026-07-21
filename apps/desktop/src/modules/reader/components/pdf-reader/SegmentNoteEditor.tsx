import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Extension, markInputRule } from '@tiptap/core';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import UnderlineExtension from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ChevronDown, ChevronRight, FileText, Languages, Loader2, MousePointer2, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { sanitizePastedNoteHtml } from '@/modules/notes/editor/pasteSanitizer';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { AnnotationTextSelection, SourceSegment } from '@/shared/types/domain';

import { ReaderEmptyState, ReaderModeSwitch } from '../ReaderSurfacePrimitives';
import { SegmentSourceContextPreview } from './SegmentSourceContextPreview';
import { TipTapToolbar } from './TipTapToolbar';
import { hasNoteText, segmentTypeLabel } from './readerUtils';
import { useStoredCollapseState } from './useStoredCollapseState';

const SegmentMarkdownShortcuts = Extension.create({
  name: 'segmentMarkdownShortcuts',
  addInputRules() {
    return [
      markInputRule({
        find: /(?:^|\s)((?:\*\*)\s?([^*]+?)\s?(?:\*\*))$/,
        type: this.editor.schema.marks.bold
      }),
      markInputRule({
        find: /(?:^|\s)((?:__)\s?([^_]+?)\s?(?:__))$/,
        type: this.editor.schema.marks.bold
      }),
      markInputRule({
        find: /(?:^|\s)((?:\*)\s?([^*]+?)\s?(?:\*))$/,
        type: this.editor.schema.marks.italic
      }),
      markInputRule({
        find: /(?:^|\s)((?:_)\s?([^_]+?)\s?(?:_))$/,
        type: this.editor.schema.marks.italic
      })
    ];
  }
});

export function SegmentNoteEditor({
  annotationCount,
  busy,
  dirty,
  highlightSelections,
  noteText,
  pdfDocument,
  sourceInitiallyExpanded = false,
  showCloseButton = true,
  segment,
  sourceEntryId,
  translatedText,
  workspaceRoot,
  className,
  onClose,
  onDelete,
  onModeChange,
  onNoteTextChange,
  onSave
}: {
  annotationCount: number;
  busy: boolean;
  dirty: boolean;
  highlightSelections?: AnnotationTextSelection[];
  noteText: string;
  pdfDocument?: PDFDocumentProxy | null;
  sourceInitiallyExpanded?: boolean;
  showCloseButton?: boolean;
  segment: SourceSegment | null;
  sourceEntryId: string;
  translatedText?: string | null;
  workspaceRoot: string | null;
  className?: string;
  onClose: () => void;
  onDelete?: () => Promise<boolean> | boolean | void;
  onModeChange: (mode: 'segment' | 'annotation') => void;
  onNoteTextChange: (value: string) => void;
  onSave: () => Promise<boolean> | boolean | void;
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: 'rounded-md bg-muted px-3 py-2 font-mono text-xs'
          }
        }
      }),
      TextStyle,
      Markdown,
      SegmentMarkdownShortcuts,
      Color,
      Highlight.configure({ multicolor: true }),
      UnderlineExtension,
      Placeholder.configure({
        placeholder: '为当前选中的片段编写笔记...'
      })
    ],
    content: noteText,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class:
          'segment-note-editor h-full min-h-0 overflow-x-hidden overflow-y-auto rounded-md border bg-white px-3 py-3 text-sm leading-6 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_ol]:ml-5 [&_ol]:list-decimal [&_pre]:my-2 [&_ul]:ml-5 [&_ul]:list-disc'
      },
      transformPastedHTML: sanitizePastedNoteHtml
    },
    onUpdate: ({ editor: currentEditor }) => {
      onNoteTextChange(currentEditor.getMarkdown());
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.commands.setContent(noteText, {
      contentType: 'markdown',
      emitUpdate: false
    });
  }, [editor, noteText, segment?.uid]);

  const translationPreviewText = translatedText?.trim() || null;
  const [contextExpanded, setContextExpanded] = useState(sourceInitiallyExpanded);
  const {
    collapsed: translationCollapsed,
    toggleCollapsed: toggleTranslationCollapsed
  } = useStoredCollapseState('translationCollapsed');

  return (
    <aside className={cn('grid h-full min-h-0 min-w-0 max-w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l bg-card', className)}>
      <div className="min-w-0 border-b bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">片段笔记</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {segment
                ? `${segmentTypeLabel(segment.segment_type)} · 第 ${segment.page_idx + 1} 页`
                : '请先选择一个片段'}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {busy ? <Badge variant="outline">保存中</Badge> : null}
            {!busy && dirty ? <Badge variant="secondary">未保存</Badge> : null}
            {!busy && segment && !hasNoteText(noteText) ? (
              <Badge variant="outline">空白</Badge>
            ) : null}

            <Button
              disabled={!segment || busy || !dirty}
              size="sm"
              type="button"
              onClick={() => void onSave()}
            >
              {busy ? (
                <Loader2 className="animate-spin" size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              保存
            </Button>

            {onDelete ? (
              <Button
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                size="icon-xs"
                title="删除片段笔记"
                type="button"
                variant="ghost"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            ) : null}

            {showCloseButton ? (
              <Button
                size="icon-xs"
                title="关闭笔记"
                type="button"
                variant="ghost"
                onClick={onClose}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <ReaderModeSwitch
          className="mt-2"
          items={[
            { label: '片段笔记', value: 'segment' },
            { badge: annotationCount > 0 ? annotationCount : null, label: '批注', value: 'annotation' }
          ]}
          value="segment"
          onValueChange={onModeChange}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden p-3">
        {segment ? (
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
            <section className="shrink-0 rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="min-w-[11rem] flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-foreground">
                    <FileText size={13} aria-hidden="true" />
                    <span>来源上下文</span>
                    <span className="font-normal text-muted-foreground">第 {segment.page_idx + 1} 页 · {segmentTypeLabel(segment.segment_type)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={segment.text.trim() || segment.markdown?.trim() || undefined}>
                    {segment.text.trim() || segment.markdown?.trim() || '暂无解析文本'}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {translationPreviewText ? (
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={toggleTranslationCollapsed}
                    >
                      <Languages size={13} aria-hidden="true" />
                      {translationCollapsed ? '查看译文' : '收起译文'}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => setContextExpanded((current) => !current)}
                  >
                    {contextExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    {contextExpanded ? '收起原文' : '查看原文'}
                  </Button>
                </div>
              </div>

              {contextExpanded ? (
                <div className="mt-2 min-w-0">
                  <SegmentSourceContextPreview
                    defaultExpanded
                    embeddedOriginal
                    highlightSelections={highlightSelections}
                    pdfDocument={pdfDocument}
                    segment={segment}
                    sourceEntryId={sourceEntryId}
                    workspaceRoot={workspaceRoot}
                  />
                </div>
              ) : null}

              {translationPreviewText && !translationCollapsed ? (
                <div className="mt-2 max-h-40 min-w-0 overflow-y-auto overscroll-contain rounded-md border bg-white px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                  <SourceSnapshotPreview
                    allowScroll={false}
                    compact
                    markdown={translationPreviewText}
                    segmentType={segment.segment_type}
                  />
                </div>
              ) : null}
            </section>

            <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-t border-border pt-3">
              <TipTapToolbar editor={editor} disabled={false} />
              <div className="min-h-0 min-w-0 overflow-hidden [&_.tiptap]:h-full">
                <EditorContent className="h-full min-h-0" editor={editor} />
              </div>
            </div>
          </div>
        ) : (
          <ReaderEmptyState
            className="min-h-full"
            description="点击 PDF 或重排视图中的原文片段，即可编辑对应的片段笔记。"
            icon={MousePointer2}
            title="选择一个片段"
          />
        )}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除片段笔记？</DialogTitle>
            <DialogDescription>此操作会移除当前片段的笔记，无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy} type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={busy}
              type="button"
              variant="destructive"
              onClick={() => {
                void Promise.resolve(onDelete?.()).then((deleted) => {
                  if (deleted !== false) setDeleteDialogOpen(false);
                });
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
