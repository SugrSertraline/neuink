import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  FilterX,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Tags,
  Trash2
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ContentItem, TagMeta } from '@/shared/types/domain';

import { EntryContentSidebar } from './EntryContentSidebar';
import { SidebarTagTreeItem } from './SidebarTagTreeItem';
import { buildTagTree } from '../utils/tagTree';

export type LibraryEntryStatus =
  | 'No PDF'
  | 'Queued'
  | 'Uploading'
  | 'Parsing'
  | 'Parsed'
  | 'Failed'
  | 'Canceled';

export type LibraryView = 'all' | 'recent' | 'parsed' | 'parsing' | 'failed' | 'no_pdf' | 'trash';

export type LibraryEntry = {
  id: string;
  contents: ContentItem[];
  title: string;
  tagIds: string[];
  tags: string[];
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  pdfFileName: string | null;
  parseMessage: string | null;
  parseEndpoint: string | null;
  status: LibraryEntryStatus;
  progress: number;
};

type LibrarySidebarProps = {
  activeTag: string | null;
  activeView: LibraryView;
  entries: LibraryEntry[];
  trashItemCount: number;
  error: string | null;
  entryExplorerOpen: boolean;
  status: 'loading' | 'ready' | 'error';
  tags: TagMeta[];
  activeContentId: string | null;
  selectedEntry: LibraryEntry | null;
  recentReadingEntryIds: string[];
  onBackToLibraryExplorer: () => void;
  onCreateMarkdownNote: () => Promise<void> | void;
  onDeleteMarkdownNote: (entryId: string, noteId: string) => Promise<void> | void;
  onAttachPdf: (entryId: string, pdfPath: string) => Promise<void> | void;
  onCreatePdfVersion: (entryId: string, pdfPath: string) => Promise<void> | void;
  onImportMineruClientResult: (entryId: string, zipPath: string) => Promise<unknown> | unknown;
  onOpenMarkdownInPdfPane: (noteId: string) => void;
  onOpenContentInRight: (contentId: string) => void;
  onRenameMarkdownNote: (entryId: string, noteId: string, title: string) => Promise<unknown> | unknown;
  onRenamePdfDisplayName: (entryId: string, fileName: string) => Promise<unknown> | unknown;
  onOpenCreateEntryTab: () => void;
  onOpenTagEditorTab: () => void;
  onSelectContent: (contentId: string) => void;
  onSelectTag: (tag: string | null) => void;
  onSelectView: (view: LibraryView) => void;
  onClearFilters: () => void;
  onUpdateEntry: (
    entryId: string,
    request: {
      fields: Record<string, string>;
      tagPaths: string[];
      title: string;
    }
  ) => Promise<unknown> | unknown;
};

type SectionKey = 'quick' | 'parsing' | 'tags';
const SECTION_STATE_STORAGE_KEY = 'neuink.librarySidebarSections';

function readStoredSectionState(): Record<SectionKey, boolean> {
  const fallback = { quick: true, parsing: true, tags: true };
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(SECTION_STATE_STORAGE_KEY) ?? '{}') as Partial<Record<SectionKey, unknown>>;
    return {
      quick: typeof stored.quick === 'boolean' ? stored.quick : fallback.quick,
      parsing: typeof stored.parsing === 'boolean' ? stored.parsing : fallback.parsing,
      tags: typeof stored.tags === 'boolean' ? stored.tags : fallback.tags
    };
  } catch {
    return fallback;
  }
}

export function LibrarySidebar({
  activeTag,
  activeView,
  activeContentId,
  entries,
  trashItemCount,
  error: _error,
  entryExplorerOpen,
  selectedEntry,
  recentReadingEntryIds,
  status,
  tags,
  onBackToLibraryExplorer,
  onCreateMarkdownNote,
  onDeleteMarkdownNote,
  onAttachPdf,
  onCreatePdfVersion,
  onImportMineruClientResult,
  onOpenMarkdownInPdfPane,
  onOpenContentInRight,
  onRenameMarkdownNote,
  onRenamePdfDisplayName,
  onOpenCreateEntryTab,
  onOpenTagEditorTab,
  onSelectContent,
  onSelectTag,
  onSelectView,
  onClearFilters,
  onUpdateEntry
}: LibrarySidebarProps) {
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(readStoredSectionState);
  const tagTree = useMemo(() => buildTagTree(tags, entries), [entries, tags]);
  const parsedCount = entries.filter((entry) => entry.status === 'Parsed').length;
  const parsingCount = entries.filter((entry) => ['Queued', 'Uploading', 'Parsing'].includes(entry.status)).length;
  const failedCount = entries.filter((entry) => entry.status === 'Failed').length;
  const noPdfCount = entries.filter((entry) => entry.status === 'No PDF').length;

  const toggleSection = (section: SectionKey) => {
    setOpenSections((current) => {
      const next = { ...current, [section]: !current[section] };
      window.localStorage.setItem(SECTION_STATE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const assignEntryToTag = (entryId: string, tagPath: string) => {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || entry.tags.includes(tagPath)) {
      return;
    }

    return onUpdateEntry(entry.id, {
      fields: entry.fields,
      tagPaths: [...entry.tags, tagPath],
      title: entry.title
    });
  };

  return (
    <aside className="app-sidebar">
      <div className="side-head">
        <span>{entryExplorerOpen ? '条目内容' : '条目库'}</span>
        {!entryExplorerOpen ? (
          <Button
            disabled={status !== 'ready'}
            size="icon-sm"
            title="创建条目"
            type="button"
            variant="ghost"
            onClick={onOpenCreateEntryTab}
          >
            <Plus size={15} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {entryExplorerOpen && selectedEntry ? (
        <EntryContentSidebar
          activeContentId={activeContentId}
          entry={selectedEntry}
          tags={tags}
          onBack={onBackToLibraryExplorer}
          onCreateMarkdownNote={onCreateMarkdownNote}
          onDeleteMarkdownNote={onDeleteMarkdownNote}
          onAttachPdf={onAttachPdf}
          onCreatePdfVersion={onCreatePdfVersion}
          onImportMineruClientResult={onImportMineruClientResult}
          onOpenMarkdownInPdfPane={onOpenMarkdownInPdfPane}
          onOpenContentInRight={onOpenContentInRight}
          onRenameMarkdownNote={onRenameMarkdownNote}
          onRenamePdfDisplayName={onRenamePdfDisplayName}
          onSelectContent={onSelectContent}
          onUpdateEntry={onUpdateEntry}
        />
      ) : (
        <ScrollArea className="side-body">
          <div className="space-y-3 p-2">
            <SidebarSection
              action={
                <Button
                  className="h-6 px-1.5 text-[10px]"
                  size="xs"
                  title="清理所有筛选并显示全部条目"
                  type="button"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClearFilters();
                  }}
                >
                  <FilterX size={12} aria-hidden="true" />
                  显示全部
                </Button>
              }
              open={openSections.quick}
              title="快速视图"
              onToggle={() => toggleSection('quick')}
            >
              <SidebarRow active={activeView === 'all'} icon={<FolderTree size={14} />} label="全部" value={entries.length} onClick={() => onSelectView('all')} />
              <SidebarRow active={activeView === 'recent'} icon={<History size={14} />} label="最近阅读" value={recentReadingEntryIds.filter((id) => entries.some((entry) => entry.id === id)).length} onClick={() => onSelectView('recent')} />
              <SidebarRow active={activeView === 'trash'} icon={<Trash2 size={14} />} label="回收站" value={trashItemCount} onClick={() => onSelectView('trash')} />
            </SidebarSection>
            <SidebarSection open={openSections.parsing} title="解析" onToggle={() => toggleSection('parsing')}>
              <SidebarRow active={activeView === 'parsed'} icon={<FileText size={14} />} label="已解析 PDF" value={parsedCount} onClick={() => onSelectView('parsed')} />
              <SidebarRow
                active={activeView === 'parsing'}
                icon={<RefreshCw className={parsingCount > 0 ? 'animate-spin' : undefined} size={14} />}
                label="解析中"
                value={parsingCount}
                onClick={() => onSelectView('parsing')}
              />
              <SidebarRow active={activeView === 'failed'} danger={failedCount > 0} icon={<AlertTriangle size={14} />} label="解析失败" value={failedCount} onClick={() => onSelectView('failed')} />
              <SidebarRow active={activeView === 'no_pdf'} icon={<FileText size={14} />} label="无 PDF" value={noPdfCount} onClick={() => onSelectView('no_pdf')} />
            </SidebarSection>

            <SidebarSection
              action={
                <div className="flex items-center gap-1">
                  <Button
                    className="size-5"
                    size="icon-xs"
                    title="编辑标签"
                    type="button"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTagEditorTab();
                    }}
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </Button>
                  <Button
                    className="h-6 px-1.5 text-[10px]"
                    size="xs"
                    type="button"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectTag(null);
                    }}
                  >
                    清除
                  </Button>
                </div>
              }
              open={openSections.tags}
              title="标签"
              onToggle={() => toggleSection('tags')}
            >
              <SidebarRow active={activeTag === null} icon={<Tags size={14} />} label="全部标签" value={entries.length} onClick={() => onSelectTag(null)} />
              {tagTree.length > 0 ? (
                <div className="space-y-0.5">
                  {tagTree.map((node) => (
                    <SidebarTagTreeItem
                      activeTag={activeTag}
                      key={node.id}
                      node={node}
                      onAssignEntryToTag={assignEntryToTag}
                      onSelectTag={onSelectTag}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无标签</div>
              )}
            </SidebarSection>
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

function SidebarSection({
  action,
  children,
  open,
  title,
  onToggle
}: {
  action?: ReactNode;
  children: ReactNode;
  open: boolean;
  title: string;
  onToggle: () => void;
}) {
  return (
    <section>
      <button
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground hover:bg-muted"
        type="button"
        onClick={onToggle}
      >
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {action}
      </button>
      {open ? <div className="space-y-0.5">{children}</div> : null}
    </section>
  );
}

function SidebarRow({
  active,
  danger,
  icon,
  label,
  onClick,
  value
}: {
  active?: boolean;
  danger?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  value: number;
}) {
  return (
    <button
      className={cn(
        'flex min-h-7 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left text-xs transition-colors',
        active
          ? 'border-primary/20 bg-accent font-bold text-primary'
          : danger
            ? 'text-destructive hover:bg-destructive/5'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      type="button"
      onClick={onClick}
    >
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-extrabold', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
        {value}
      </span>
    </button>
  );
}
