import type { AssistantContextSnapshot, ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { BrowserTabTarget } from '@/shared/ipc/browserApi';
import type { AssistantActiveNote, AssistantComposerSnapshot, AssistantContext, AssistantSegmentContextItem } from '@/shared/types/assistant';
import type { WorkspaceContext, WorkspaceReference } from '@/shared/types/modelContext';

const INLINE_SCOPE_LIMIT = 20;

export function scopeMetadata(scope: ScopeSnapshot) {
  return { entries: scope.entry_ids.map((id, index) => ({ id, title: scope.entry_titles[index] ?? id })),
    tags: scope.tag_ids.map((id, index) => ({ id, name: scope.tag_names[index] ?? id })) };
}

export async function scopeContextRef(scope: ScopeSnapshot) {
  return `scope:${await digestText(JSON.stringify(scopeMetadata(scope)))}`;
}

async function observeScope(scope: ScopeSnapshot): Promise<WorkspaceContext['scope']> {
  const metadata = scopeMetadata(scope);
  if (metadata.entries.length <= INLINE_SCOPE_LIMIT && metadata.tags.length <= INLINE_SCOPE_LIMIT
    && JSON.stringify(metadata).length <= 6000) return metadata;
  return { entries: [], tags: [], entry_count: metadata.entries.length, tag_count: metadata.tags.length,
    context_ref: await scopeContextRef(scope) };
}

export async function selectionContextRef(item: AssistantSegmentContextItem): Promise<string> {
  const revision = await digestText(item.text);
  return `selection:${item.entryId}:${item.segmentUid}:${revision}`;
}

async function digestText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Extract metadata from already frozen host observations. Never reads a document or note body. */
export async function observeWorkspaceContext(options: {
  scope: ScopeSnapshot;
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  assistantContext?: AssistantContext | null;
  composerSnapshot?: AssistantComposerSnapshot | null;
  tagMentionScopes?: Record<string, ScopeSnapshot>;
  contextSnapshot?: AssistantContextSnapshot | null;
  browserTabTarget?: BrowserTabTarget | null;
}): Promise<WorkspaceContext> {
  const { scope, assistantContext, composerSnapshot, contextSnapshot, browserTabTarget } = options;
  const entry = options.currentEntry !== undefined ? options.currentEntry : (contextSnapshot?.active_entry
    ? { id: contextSnapshot.active_entry.entry_id, title: contextSnapshot.active_entry.entry_title } : null);
  const note = options.currentNote !== undefined ? options.currentNote : (contextSnapshot?.active_note ? {
    entryId: contextSnapshot.active_note.entry_id, noteId: contextSnapshot.active_note.note_id,
    noteTitle: contextSnapshot.active_note.note_title
  } : null);
  const pinned = await Promise.all((assistantContext?.items ?? []).filter(item => item.kind === 'segment').map(async item => {
    const context_ref = await selectionContextRef(item);
    return { entry_id: item.entryId, segment_uid: item.segmentUid, revision: context_ref.slice(context_ref.lastIndexOf(':') + 1), context_ref };
  }));
  const references: WorkspaceReference[] = composerSnapshot?.mentions.length
    ? await Promise.all(composerSnapshot.mentions.map(async mention => {
      if (mention.kind === 'tag') {
        const target = mention.tagId && options.tagMentionScopes?.[mention.tagId] || scope;
        const metadata = await observeScope(target);
        return { ref: mention.marker, kind: 'tag', tag_id: mention.tagId ?? undefined, title: mention.tagName ?? mention.label,
          ...(metadata.context_ref ? { scope_ref: metadata.context_ref, entry_count: target.entry_ids.length }
            : { entry_ids: target.entry_ids }) };
      }
      return { ref: mention.marker, kind: mention.kind, entry_id: mention.entryId, title: mention.contentTitle || mention.entryTitle,
        ...(mention.contentId ? { content_id: mention.contentId } : {}),
        ...(mention.segmentUid ? { segment_uid: mention.segmentUid } : {}) };
    }))
    : (assistantContext?.items ?? []).filter(item => item.kind === 'entry').map(item => ({ kind: item.contentKind ?? 'entry',
      entry_id: item.entryId, title: item.contentTitle || item.entryTitle, ...(item.contentId ? { content_id: item.contentId } : {}) }));
  let browser: WorkspaceContext['browser'] = null;
  if (browserTabTarget) {
    let url = '';
    try { const parsed = new URL(browserTabTarget.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.origin + parsed.pathname; }
    catch { /* The browser tool validates the authoritative target before reading it. */ }
    browser = { url, title: browserTabTarget.title.slice(0, 1_000),
      identity: await digestText(JSON.stringify([browserTabTarget.id, browserTabTarget.navigationId ?? ''])) };
  }
  return { version: 1,
    scope: await observeScope(scope),
    active_entry: entry ? { id: entry.id, title: entry.title, ...(contextSnapshot?.active_entry?.entry_id === entry.id && contextSnapshot.active_entry.revision
      ? { revision: contextSnapshot.active_entry.revision } : {}) } : null,
    active_note: note ? { entry_id: note.entryId, id: note.noteId, title: note.noteTitle,
      ...(contextSnapshot?.active_note?.entry_id === note.entryId && contextSnapshot.active_note.note_id === note.noteId && contextSnapshot.active_note.revision
        ? { revision: contextSnapshot.active_note.revision } : {}) } : null,
    browser, references, pinned_segments: pinned };
}
