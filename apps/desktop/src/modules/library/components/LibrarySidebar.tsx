import {
  AlertTriangle,
  FileText,
  FolderTree,
  FilterX,
  History,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import type { ContentItem, TagMeta } from '@/shared/types/domain';

import { EntryContentSidebar } from './EntryContentSidebar';
import type { EntryUpdate } from './EntryEditPage';
import { useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';
import type { EntryTagNotesContext } from '@/modules/notes/components/EntryTagNotesSidebar';
import { SidebarPanel } from './SidebarPanel';
import { SidebarPanelGroup } from './SidebarPanelGroup';
import { TagNavigation } from './TagNavigation';
import { buildTagTree } from '../utils/tagTree';
import { LIBRARY_VIEW_LABELS, type LibraryView } from '../utils/libraryView';

export type LibraryEntryStatus =
  | 'No PDF'
  | 'Queued'
  | 'Uploading'
  | 'Parsing'
  | 'Parsed'
  | 'Failed'
  | 'Canceled';

export type { LibraryView } from '../utils/libraryView';

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
  tagNotes?: EntryTagNotesContext;
  activeContentId: string | null;
  selectedEntry: LibraryEntry | null;
  recentReadingEntryIds: string[];
  onCreateMarkdownNote: () => Promise<void> | void;
  onDeleteMarkdownNote: (entryId: string, noteId: string) => Promise<void> | void;
  onAttachPdf: (entryId: string, pdfPath: string) => Promise<void> | void;
  onOpenMarkdownInPdfPane: (noteId: string) => void;
  onOpenContentInRight: (contentId: string) => void;
  onRenameMarkdownNote: (entryId: string, noteId: string, title: string) => Promise<unknown> | unknown;
  onRenamePdfDisplayName: (entryId: string, fileName: string) => Promise<unknown> | unknown;
  onOpenCreateEntryTab: () => void;
  onOpenTagEditorTab: () => void;
  onSelectContent: (contentId: string) => void;
  onOpenTagDetails: (tagId: string) => void;
  onSelectView: (view: LibraryView) => void;
  onClearFilters: () => void;
  onUpdateEntry: (entryId: string, request: EntryUpdate) => Promise<unknown> | unknown;
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
  error,
  entryExplorerOpen,
  selectedEntry,
  recentReadingEntryIds,
  status,
  tags,
  tagNotes,
  onCreateMarkdownNote,
  onDeleteMarkdownNote,
  onAttachPdf,
  onOpenMarkdownInPdfPane,
  onOpenContentInRight,
  onRenameMarkdownNote,
  onRenamePdfDisplayName,
  onOpenCreateEntryTab,
  onOpenTagEditorTab,
  onSelectContent,
  onOpenTagDetails,
  onSelectView,
  onClearFilters,
  onUpdateEntry
}: LibrarySidebarProps) {
  const { notify } = useToast();
  const noteCatalog = useWorkspaceNotes();
  const deletedTagNoteCount = noteCatalog?.catalog.notes.filter(note => note.target.owner.kind === 'tag_reading' && note.deleted_at).length ?? 0;
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

  const assignEntryToTag = useCallback(async (entryId: string, tagPath: string) => {
    const entry = entries.find((item) => item.id === entryId);
    if (status !== 'ready' || !entry || entry.tags.includes(tagPath)) {
      return;
    }

    try {
      await onUpdateEntry(entry.id, {
        fields: entry.fields,
        tagPaths: [...entry.tags, tagPath],
        title: entry.title
      });
      notify({
        tone: 'success',
        title: '标签已添加',
        description: `已将“${entry.title}”添加到“${tagPath}”。`
      });
    } catch (error) {
      notify({
        tone: 'danger',
        title: '添加标签失败',
        description: error instanceof Error ? error.message : `无法将“${entry.title}”添加到“${tagPath}”。`
      });
    }
  }, [entries, notify, onUpdateEntry, status]);

  return (
    <aside className="app-sidebar">
      <div className="side-head">
        <div className="flex min-w-0 items-center gap-1">
          <span>{entryExplorerOpen ? '条目详情' : '条目库'}</span>
        </div>
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
          tagNotes={tagNotes}
          onOpenTrash={() => onSelectView('trash')}
          onCreateMarkdownNote={onCreateMarkdownNote}
          onDeleteMarkdownNote={onDeleteMarkdownNote}
          onAttachPdf={onAttachPdf}
          onOpenMarkdownInPdfPane={onOpenMarkdownInPdfPane}
          onOpenContentInRight={onOpenContentInRight}
          onRenameMarkdownNote={onRenameMarkdownNote}
          onRenamePdfDisplayName={onRenamePdfDisplayName}
          onSelectContent={onSelectContent}
        />
      ) : (
        <SidebarPanelGroup>
          <SidebarPanel
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
            name="快速视图"
            label="快速视图"
            onToggle={() => toggleSection('quick')}
          >
            <SidebarRow active={activeView === 'all'} icon={<FolderTree size={14} />} label={LIBRARY_VIEW_LABELS.all} value={entries.length} onClick={() => onSelectView('all')} />
            <SidebarRow active={activeView === 'recent'} icon={<History size={14} />} label={LIBRARY_VIEW_LABELS.recent} value={recentReadingEntryIds.filter((id) => entries.some((entry) => entry.id === id)).length} onClick={() => onSelectView('recent')} />
            <SidebarRow active={activeView === 'trash'} icon={<Trash2 size={14} />} label={LIBRARY_VIEW_LABELS.trash} value={trashItemCount + deletedTagNoteCount} onClick={() => onSelectView('trash')} />
          </SidebarPanel>
          <SidebarPanel name="解析" label="解析" weight={1.25} open={openSections.parsing} onToggle={() => toggleSection('parsing')}>
            <SidebarRow active={activeView === 'parsed'} icon={<FileText size={14} />} label={LIBRARY_VIEW_LABELS.parsed} value={parsedCount} onClick={() => onSelectView('parsed')} />
            <SidebarRow
              active={activeView === 'parsing'}
              icon={<RefreshCw className={parsingCount > 0 ? 'animate-spin' : undefined} size={14} />}
              label={LIBRARY_VIEW_LABELS.parsing}
              value={parsingCount}
              onClick={() => onSelectView('parsing')}
            />
            <SidebarRow active={activeView === 'failed'} danger={failedCount > 0} icon={<AlertTriangle size={14} />} label={LIBRARY_VIEW_LABELS.failed} value={failedCount} onClick={() => onSelectView('failed')} />
            <SidebarRow active={activeView === 'no_pdf'} icon={<FileText size={14} />} label={LIBRARY_VIEW_LABELS.no_pdf} value={noPdfCount} onClick={() => onSelectView('no_pdf')} />
          </SidebarPanel>

          <TagNavigation
            panel={{ weight: 2 }}
            activeTag={activeTag}
            nodes={tagTree}
            status={status}
            error={error}
            open={openSections.tags}
            onAssignEntryToTag={assignEntryToTag}
            onOpenTagDetails={onOpenTagDetails}
            onToggleOpen={() => toggleSection('tags')}
            onEditTags={onOpenTagEditorTab}
          />
        </SidebarPanelGroup>
      )}
    </aside>
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
      data-material="content-row"
      data-active={active}
      data-interactive="true"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-7 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
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
