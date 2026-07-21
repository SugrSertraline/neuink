import { MessageSquare, PanelRight, Search, Settings } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  entryContentSurface,
  entryContentId,
  initialWorkspaceSurfaceLayout,
  surfaceKey,
  workspaceSurfaceReducer,
  type WorkspacePaneId,
  type WorkspaceSurface
} from './workspaceSurface';
import {
  resolveActiveActivityPanel,
  type SidePanel
} from './activityBarState';
import {
  clampWorkspaceSplitLeftWidth,
  WORKSPACE_SPLIT_DIVIDER_WIDTH,
  WORKSPACE_SPLIT_MIN_LEFT_WIDTH,
  WORKSPACE_SPLIT_MIN_RIGHT_WIDTH
} from './workspaceSplit';
import { AssistantPanel } from '../modules/assistant/components/AssistantPanel';
import type { AssistantComposerDraft } from '../modules/assistant/components/AssistantComposerEditor';
import type { SourceLinkOpenTarget } from '../modules/notes/editor/SourceLinkNode';
import { LibrarySidebar, type LibraryEntry, type LibraryView } from '../modules/library/components/LibrarySidebar';
import { buildTagPathById } from '../modules/library/utils/tagTree';
import { ReaderPane } from '../modules/reader/components/ReaderPane';
import type { PdfJumpRequest, SidePaneState, SidePaneTarget } from '../modules/reader/types';
import { SearchDialog } from '../modules/search/components/SearchDialog';
import { SearchPanel } from '../modules/search/components/SearchPanel';
import { useSearchIndexStatus } from '../modules/search/hooks/useSearchIndexStatus';
import { JobStatusDock } from '../shared/components/JobStatusDock';
import { TitleBar } from '../shared/components/TitleBar';
import { useToast } from '../shared/hooks/useToast';
import { useWorkspace } from '../shared/hooks/useWorkspace';
import { useWorkspaceJobs } from '../shared/hooks/useWorkspaceJobs';
import {
  APP_THEME_STORAGE_KEY,
  APP_THEME_PRESETS,
  readStoredThemePreset,
  type AppThemePresetId
} from '../shared/lib/themePresets';
import {
  persistReaderPreferences,
  readStoredReaderPreferences,
  type ReaderPreferences
} from '../shared/lib/readerPreferences';
import {
  CLOUD_PARSER_ENDPOINT,
  getEffectiveParserEndpoint
} from '../shared/lib/parserSettings';
import {
  applyNoteProposal,
  isSciverseConversationSource,
  type Conversation,
  type ConversationSourceLink
} from '../shared/ipc/assistantApi';
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantContext,
  AssistantContextAddOptions,
  AssistantContextInput,
  AssistantNoteProposal,
  AssistantEntryMetaProposal,
  AssistantTagProposal
} from '../shared/types/assistant';

import type {
  SearchIndexBuildStatus,
  SearchIndexStatus
} from '../shared/ipc/workspaceApi';
import type { EntryMeta } from '../shared/types/domain';

export const DEFAULT_MINERU_ENDPOINT = CLOUD_PARSER_ENDPOINT;
// Internal and organization-specific service addresses belong in the local .env only.
// Keep the source fallback empty so public builds do not expose deployment details.
export const LEGACY_MINERU_ENDPOINTS = new Set(
  String(import.meta.env.VITE_LEGACY_MINERU_ENDPOINTS ?? '')
    .split(',')
    .map((endpoint: string) => endpoint.trim())
    .filter(Boolean)
);
export const DEFAULT_POPO_ENHANCEMENT_ENDPOINT =
  String(import.meta.env.VITE_POPO_ENHANCEMENT_ENDPOINT ?? '').trim();
export const PARSER_ENDPOINT_STORAGE_KEY = 'neuink.parserEndpoint';
export const PARSER_API_KEY_STORAGE_KEY = 'neuink.parserApiKey';
export const POPO_ENHANCEMENT_ENABLED_STORAGE_KEY = 'neuink.popoEnhancementEnabled';
export const POPO_ENHANCEMENT_ENDPOINT_STORAGE_KEY = 'neuink.popoEnhancementEndpoint';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'neuink.sidebarWidth';
export const SIDEBAR_OPEN_STORAGE_KEY = 'neuink.sidebarOpen';
export const SIDE_PANEL_STORAGE_KEY = 'neuink.sidePanel';
export const LIBRARY_VIEW_STORAGE_KEY = 'neuink.libraryView';
export const RECENT_READING_STORAGE_KEY = 'neuink.recentReading';
export const PARSE_POLL_INTERVAL_MS = 6000;
export const ACTIVE_PARSE_STATUSES = new Set(['queued', 'uploading', 'uploaded', 'parsing']);
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 820;
export const DEFAULT_SIDEBAR_WIDTH = 280;
export const WORKSPACE_SPLIT_WIDTH_STORAGE_KEY = 'neuink.workspaceSplitLeftWidth';
export const ENTRY_CONTENT_TAB_PREFIX = 'entry-content:';

export const EMPTY_SIDE_PANE: SidePaneState = {
  pinned: false,
  requestKey: 0,
  target: null
};

export function entryContentTabValue(entryId: string, contentId: string) {
  return ENTRY_CONTENT_TAB_PREFIX + entryId + '|' + contentId;
}

export function parseEntryContentTab(tab: string) {
  if (!tab.startsWith(ENTRY_CONTENT_TAB_PREFIX)) {
    return null;
  }

  const raw = tab.slice(ENTRY_CONTENT_TAB_PREFIX.length);
  const separatorIndex = raw.indexOf('|');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return null;
  }

  return {
    contentId: raw.slice(separatorIndex + 1),
    entryId: raw.slice(0, separatorIndex)
  };
}

export function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function readStoredSidebarWidth() {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(saved) ? clampSidebarWidth(saved) : DEFAULT_SIDEBAR_WIDTH;
}

export function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === '1';
}

export function readStoredSidePanel(): SidePanel {
  if (typeof window === 'undefined') return 'library';
  const value = window.localStorage.getItem(SIDE_PANEL_STORAGE_KEY);
  return value === 'assistant' || value === 'search' || value === 'library' ? value : 'library';
}

export function readStoredLibraryView(): LibraryView {
  if (typeof window === 'undefined') return 'all';
  const value = window.localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY);
  return value === 'recent' || value === 'parsed' || value === 'parsing' || value === 'failed' || value === 'no_pdf' || value === 'trash' ? value : 'all';
}

export function readStoredRecentReading() {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_READING_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function readStoredWorkspaceSplitLeftWidth() {
  if (typeof window === 'undefined') {
    return null;
  }
  const saved = Number(window.localStorage.getItem(WORKSPACE_SPLIT_WIDTH_STORAGE_KEY));
  return Number.isFinite(saved) && saved >= WORKSPACE_SPLIT_MIN_LEFT_WIDTH
    ? Math.round(saved)
    : null;
}

export function getWorkspaceSplitContainerWidth() {
  if (typeof document === 'undefined') {
    return WORKSPACE_SPLIT_MIN_LEFT_WIDTH + WORKSPACE_SPLIT_DIVIDER_WIDTH + WORKSPACE_SPLIT_MIN_RIGHT_WIDTH;
  }
  const editor = document.querySelector('.app-editor');
  if (editor instanceof HTMLElement) {
    const width = editor.getBoundingClientRect().width;
    if (width > 0) {
      return width;
    }
  }
  return Math.max(
    WORKSPACE_SPLIT_MIN_LEFT_WIDTH + WORKSPACE_SPLIT_DIVIDER_WIDTH + WORKSPACE_SPLIT_MIN_RIGHT_WIDTH,
    window.innerWidth - DEFAULT_SIDEBAR_WIDTH
  );
}

export function getDefaultWorkspaceSplitLeftWidth() {
  const containerWidth = getWorkspaceSplitContainerWidth();
  return clampWorkspaceSplitLeftWidth(containerWidth / 2, containerWidth);
}

export function toLibraryEntry(entry: EntryMeta, tagPathById: Map<string, string>): LibraryEntry {
  const parseStatus = entry.pdf?.parse.status;
  const status =
    parseStatus === 'succeeded'
      ? 'Parsed'
      : parseStatus === 'failed'
        ? 'Failed'
        : parseStatus === 'canceled'
          ? 'Canceled'
          : parseStatus === 'uploading' || parseStatus === 'uploaded'
            ? 'Uploading'
            : parseStatus === 'parsing'
              ? 'Parsing'
              : entry.pdf
                ? 'Queued'
                : 'No PDF';
  const tagIds = entry.tags ?? [];

  return {
    id: entry.id,
    contents: entry.contents ?? [],
    title: entry.title,
    tagIds,
    tags: tagIds.map((tagId) => tagPathById.get(tagId)).filter((tag): tag is string => Boolean(tag)),
    fields: entry.fields,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    pdfFileName: entry.pdf?.file_name ?? null,
    parseMessage: entry.pdf?.parse.message ?? null,
    parseEndpoint: entry.pdf?.parse.endpoint ?? null,
    status,
    progress: status === 'Parsed' ? 100 : status === 'Queued' ? 32 : 0
  };
}

export function formatVectorStatus(
  status: SearchIndexStatus | null,
  error: string | null,
  buildStatus: SearchIndexBuildStatus | null = null
) {
  if (buildStatus?.state === 'queued' || buildStatus?.state === 'running') {
    const progress = buildStatus.total > 0
      ? Math.round((buildStatus.completed / buildStatus.total) * 100)
      : 0;
    return buildStatus.total > 0
      ? `向量：构建中 ${buildStatus.completed}/${buildStatus.total} · ${progress}%`
      : '向量：准备构建';
  }
  if (buildStatus?.state === 'failed') {
    return '向量：构建失败';
  }
  if (error) {
    return '向量：不可用';
  }
  if (!status) {
    return '向量：检查中';
  }
  if (status.semantic_document_count === 0) {
    return '向量：无内容';
  }
  if (status.semantic_status === 'ready_memory') {
    return '向量：就绪 ' + status.semantic_document_count;
  }
  if (status.semantic_status === 'ready_disk') {
    return '向量：缓存 ' + (status.semantic_disk_cache_record_count ?? status.semantic_document_count);
  }
  return '向量：待构建 ' + status.semantic_document_count;
}

export function surfaceLabel(surface: WorkspaceSurface, entries: LibraryEntry[]) {
  const entryTitle = 'entryId' in surface
    ? entries.find((entry) => entry.id === surface.entryId)?.title
    : null;
  switch (surface.kind) {
    case 'library': return '条目库';
    case 'settings': return '设置';
    case 'create-entry': return '新建条目';
    case 'tag-editor': return '标签管理';
    case 'entry-overview': return (entryTitle ?? '条目') + ' · 概览';
    case 'pdf': return (entryTitle ?? '条目') + ' · PDF';
    case 'reflow': return (entryTitle ?? '条目') + ' · 重排视图';
    case 'note': return (entryTitle ?? '条目') + ' · 笔记';
    case 'segment-notes': case 'annotations': return (entryTitle ?? '条目') + ' · 片段记录';
    case 'source-links': return (entryTitle ?? '条目') + ' · 来源链接';
    case 'entry-trash': return (entryTitle ?? '条目') + ' · 回收站';
  }
}

export function ActivityButton({
  active,
  children,
  label,
  onClick,
  onContextMenu
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  onContextMenu?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={active ? 'active' : undefined}
          type="button"
          onClick={onClick}
          onContextMenu={(event) => {
            if (!onContextMenu) return;
            event.preventDefault();
            onContextMenu();
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function firstContentId(entry: LibraryEntry) {
  if (entry.pdfFileName) {
    return 'pdf';
  }
  const note = entry.contents.find((content) => content.kind === 'note');
  return note ? 'note:' + note.note_id : 'overview';
}

export function noteIdFromContentId(contentId: string | null) {
  return contentId?.startsWith('note:') ? contentId.slice('note:'.length) : null;
}

export function ensureTrailingNewline(markdown: string) {
  const trimmed = markdown.trim();
  return trimmed ? trimmed + '\n' : '';
}

export function conversationToMarkdown(conversation: Conversation) {
  const footnotes: string[] = [];
  const lines = [
    '---',
    'kind: ai-conversation',
    'conversation_id: ' + conversation.id,
    'created_at: ' + conversation.created_at,
    'updated_at: ' + conversation.updated_at,
    '---',
    '',
    '# ' + conversation.title,
    '',
    conversationScopeMarkdown(conversation),
    ''
  ];

  for (const message of conversation.messages) {
    lines.push('## ' + (message.role === 'user' ? 'You' : 'Neuink'));
    lines.push('');
    lines.push(messageMarkdownWithFootnotes(message.content, message.source_links, footnotes));
    lines.push('');
  }

  if (footnotes.length > 0) {
    lines.push('## Sources');
    lines.push('');
    lines.push(...footnotes);
    lines.push('');
  }

  return ensureTrailingNewline(lines.join('\n').replace(/\n{3,}/g, '\n\n'));
}

export function conversationScopeMarkdown(conversation: Conversation) {
  const tags = conversation.scope_snapshot.tag_names;
  const entries = conversation.scope_snapshot.entry_titles;
  const lines = ['## Scope', ''];

  if (tags.length > 0) {
    lines.push('Tags: ' + tags.join(' / '));
  }

  if (entries.length > 0) {
    lines.push('Entries:');
    lines.push(...entries.map((title, index) => '- ' + title + ' (' + (conversation.scope_snapshot.entry_ids[index] ?? '') + ')'));
  } else {
    lines.push('Entries: all parsed entries at conversation time');
  }

  return lines.join('\n');
}

export function messageMarkdownWithFootnotes(
  content: string,
  sources: ConversationSourceLink[],
  footnotes: string[]
) {
  let markdown = content.trim() || '_No content._';
  const refs: string[] = [];

  sources.forEach((source, index) => {
    const footnoteId = 'conv-source-' + (footnotes.length + 1);
    const ref = '[^' + footnoteId + ']';
    refs.push(ref);
    footnotes.push(ref + ': ' + sourceFootnoteText(source));
    markdown = markdown.split('[S' + (index + 1) + ']').join(ref);
  });

  const missingRefs = refs.filter((ref) => !markdown.includes(ref));
  if (missingRefs.length > 0) {
    markdown = markdown + '\n\nSources: ' + missingRefs.join(' ');
  }

  return markdown;
}

export function sourceFootnoteText(source: ConversationSourceLink) {
  const quote = source.quote.trim() ? ' "' + source.quote.replace(/\s+/g, ' ') + '"' : '';
  if (isSciverseConversationSource(source)) {
    const location = source.page_no != null
      ? `p.${source.page_no}`
      : source.offset != null
        ? `offset ${source.offset}`
        : `doc ${source.doc_id}`;
    return `${source.title}, Sciverse, ${location}.${quote}`;
  }
  return source.entry_title + ', p.' + (source.page_idx + 1) + ', segment ' + source.segment_uid + '.' + quote;
}
