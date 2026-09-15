import {
  ExternalLink,
  FileDown,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Redo2,
  Save,
  Undo2
} from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type MarkdownNoteFileAction = 'open' | 'reveal' | 'save-as' | null;

export function MarkdownNoteHeader({
  canEdit,
  canRedo,
  canUndo,
  compact,
  dirty,
  draftTitle,
  entryTitle,
  error,
  fileAction,
  loadFailed,
  loading,
  saving,
  sourceCount,
  title,
  titleEditing,
  workspaceAvailable,
  onCancelTitle,
  onCommitTitle,
  onDraftTitleChange,
  onOpenFile,
  onRedo,
  onReload,
  onRevealFile,
  onSave,
  onSaveAs,
  onExport,
  onStartTitleEdit,
  onTakeOver,
  onUndo
}: {
  canEdit: boolean;
  canRedo: boolean;
  canUndo: boolean;
  compact: boolean;
  dirty: boolean;
  draftTitle: string;
  entryTitle?: string;
  error: string | null;
  fileAction: MarkdownNoteFileAction;
  loadFailed: boolean;
  loading: boolean;
  saving: boolean;
  sourceCount: number;
  title: string;
  titleEditing: boolean;
  workspaceAvailable: boolean;
  onCancelTitle: () => void;
  onCommitTitle: () => void;
  onDraftTitleChange: (value: string) => void;
  onOpenFile: () => void;
  onRedo: () => void;
  onReload: () => void;
  onRevealFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport?: () => void;
  onStartTitleEdit: () => void;
  onTakeOver: () => void;
  onUndo: () => void;
}) {
  const hasSaveConflict = error?.includes('当前草稿仍保留') ?? false;
  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCommitTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancelTitle();
    }
  };

  return (
    <div className="markdown-note-header border-b bg-white">
      <div className="markdown-note-header-main flex min-h-10 min-w-0 items-center gap-2 px-3 py-2">
        {entryTitle ? (
          <>
            <span className="markdown-note-entry-title min-w-0 max-w-[40%] truncate text-sm font-semibold" title={entryTitle}>
              {entryTitle}
            </span>
            <span aria-hidden="true" className="markdown-note-header-divider text-muted-foreground/50">·</span>
          </>
        ) : null}
        {titleEditing && canEdit && !loadFailed ? (
          <Input
            aria-label="文档笔记标题"
            autoFocus
            className={cn('h-8 max-w-[28rem] font-semibold', compact && 'max-w-full')}
            value={draftTitle}
            onBlur={onCommitTitle}
            onChange={(event) => onDraftTitleChange(event.target.value)}
            onKeyDown={handleTitleKeyDown}
          />
        ) : (
          <button
            className={cn(
              'min-w-0 max-w-[36rem] truncate rounded-sm text-left text-base font-semibold outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40',
              'markdown-note-title',
              compact && 'max-w-60 text-sm'
            )}
            disabled={loading || loadFailed || !canEdit}
            title={title}
            type="button"
            onClick={onStartTitleEdit}
          >
            {title}
          </button>
        )}
        <span className="markdown-note-header-spacer min-w-0 flex-1" />
        <div aria-live="polite" className="markdown-note-save-status flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {loading ? <span>加载中…</span> : null}
          {!loading && saving ? <span>保存中…</span> : null}
          {!loading && !saving && canEdit && dirty ? <span>未保存</span> : null}
          {!loading && !saving && !canEdit && !error ? <span>只读</span> : null}
          {!loading && !saving && canEdit && !dirty && !error ? <span>已保存</span> : null}
          {error ? (
            <span className="max-w-48 truncate text-destructive" title={error}>
              {loadFailed ? '加载失败' : hasSaveConflict ? '版本冲突' : '保存失败'}
            </span>
          ) : null}
        </div>
        <div className="markdown-note-compact-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="笔记操作"
                disabled={loading || fileAction !== null}
                size="icon-xs"
                title="笔记操作"
                type="button"
                variant="ghost"
              >
                {fileAction ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent viewportAligned align="end" className="w-48">
              {!canEdit && !loadFailed ? (
                <DropdownMenuItem onSelect={onTakeOver}>在此处继续编辑</DropdownMenuItem>
              ) : null}
              {loadFailed ? <DropdownMenuItem onSelect={onReload}>重新加载</DropdownMenuItem> : null}
              <DropdownMenuItem disabled={loadFailed || !canEdit || !canUndo} onSelect={onUndo}>
                <Undo2 aria-hidden="true" />撤销
              </DropdownMenuItem>
              <DropdownMenuItem disabled={loadFailed || !canEdit || !canRedo} onSelect={onRedo}>
                <Redo2 aria-hidden="true" />恢复
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={loadFailed || saving || !canEdit || !dirty || hasSaveConflict}
                onSelect={onSave}
              >
                <Save aria-hidden="true" />保存
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!workspaceAvailable || loadFailed} onSelect={onOpenFile}>
                <ExternalLink aria-hidden="true" />打开 Markdown
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!workspaceAvailable || loadFailed} onSelect={onRevealFile}>
                <FolderOpen aria-hidden="true" />在文件夹中显示
              </DropdownMenuItem>
              <DropdownMenuItem disabled={loadFailed} onSelect={onSaveAs}>
                <FileDown aria-hidden="true" />另存为
              </DropdownMenuItem>
              {onExport ? <DropdownMenuItem disabled={!workspaceAvailable || loadFailed} onSelect={onExport}>
                <FileDown aria-hidden="true" />导出 Word / TXT
              </DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="markdown-note-header-actions flex min-h-8 min-w-0 items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
        {!loading && !canEdit ? (
          <>
            <Badge variant="secondary">只读</Badge>
            <Button size="xs" type="button" variant="outline" onClick={onTakeOver}>
              在此处继续编辑
            </Button>
          </>
        ) : null}
        {!loading && loadFailed ? (
          <Button size="xs" type="button" variant="outline" onClick={onReload}>重新加载</Button>
        ) : null}
        {!loading && canEdit && !loadFailed ? (
          <span className="markdown-note-autosave-hint">{hasSaveConflict ? '自动保存已暂停' : '自动保存 · Ctrl/Cmd + S'}</span>
        ) : null}
        {!loading && sourceCount > 0 ? <span className="markdown-note-source-count">来源 {sourceCount}</span> : null}
        <span className="min-w-0 flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="文件操作"
              disabled={loading || loadFailed || fileAction !== null}
              size="icon-xs"
              title="文件操作"
              type="button"
              variant="outline"
            >
              {fileAction ? <Loader2 className="animate-spin" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent viewportAligned align="end" className="w-44">
            <DropdownMenuItem disabled={!workspaceAvailable} onSelect={onOpenFile}>
              <ExternalLink aria-hidden="true" />打开 Markdown
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!workspaceAvailable} onSelect={onRevealFile}>
              <FolderOpen aria-hidden="true" />在文件夹中显示
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSaveAs}>
              <FileDown aria-hidden="true" />另存为
            </DropdownMenuItem>
            {onExport ? <DropdownMenuItem disabled={!workspaceAvailable} onSelect={onExport}>
              <FileDown aria-hidden="true" />导出 Word / TXT
            </DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          aria-label="撤销"
          disabled={loading || loadFailed || !canEdit || !canUndo}
          size="icon-xs"
          title="撤销（Ctrl/Cmd + Z）"
          type="button"
          variant="outline"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onUndo}
        >
          <Undo2 aria-hidden="true" />
        </Button>
        <Button
          aria-label="恢复"
          disabled={loading || loadFailed || !canEdit || !canRedo}
          size="icon-xs"
          title="恢复（Ctrl/Cmd + Shift + Z）"
          type="button"
          variant="outline"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRedo}
        >
          <Redo2 aria-hidden="true" />
        </Button>
        <Button
          disabled={loading || loadFailed || saving || !canEdit || !dirty || hasSaveConflict}
          size="xs"
          title="保存（Ctrl/Cmd + S）"
          type="button"
          onClick={onSave}
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          <span className="markdown-note-save-label">保存</span>
        </Button>
      </div>
    </div>
  );
}
