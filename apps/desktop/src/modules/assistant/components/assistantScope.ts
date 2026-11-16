import type { ConversationMessage, ScopeIntent, ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { AssistantComposerMention, AssistantContext } from '@/shared/types/assistant';
import type { TagMeta } from '@/shared/types/domain';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { collectDescendantTagIds } from '@/modules/library/utils/tagTree';

/**
 * `scope_intent` separates "whole library" from "these papers". Entry lists alone
 * cannot tell them apart, and the entry list of a library scope must never be read
 * as an explicit selection.
 */

export function buildAssistantScope({
  activeEntry,
  activeTag,
  entries,
  selectedTagIds,
  tags
}: {
  activeEntry: LibraryEntry | null;
  activeTag: string | null;
  entries: LibraryEntry[];
  selectedTagIds: string[];
  tags: TagMeta[];
}): ScopeSnapshot {
  const requestedTagIds = selectedTagIds.length > 0
    ? selectedTagIds
    : activeTag
      ? [activeTag]
      : [];
  if (requestedTagIds.length > 0) {
    const knownTagIds = new Set(tags.map((tag) => tag.id));
    const tagIds = new Set<string>();
    for (const tagId of requestedTagIds) {
      for (const descendantId of collectDescendantTagIds(tags, tagId)) {
        tagIds.add(descendantId);
      }
    }
    const scopedEntries = entries.filter((entry) =>
      entry.tagIds.some((tagId) => tagIds.has(tagId))
    );
    const tagNames = tags
      .filter((tag) => tagIds.has(tag.id))
      .map((tag) => tag.name)
      .sort();
    return {
      tag_ids: [...tagIds],
      tag_names: tagNames,
      entry_ids: scopedEntries.map((entry) => entry.id),
      entry_titles: scopedEntries.map((entry) => entry.title),
      scope_intent: requestedTagIds.some((tagId) => !knownTagIds.has(tagId)) ? 'unresolved' : 'selection'
    };
  }

  const scopedEntries = activeEntry
    ? [activeEntry]
    : entries;
  return {
    tag_ids: [],
    tag_names: [],
    entry_ids: scopedEntries.map((entry) => entry.id),
    entry_titles: scopedEntries.map((entry) => entry.title),
    scope_intent: activeEntry ? 'selection' : 'library'
  };
}

export function buildTagMentionScopes({
  entries,
  tagIds,
  tags
}: {
  entries: LibraryEntry[];
  tagIds: string[];
  tags: TagMeta[];
}) {
  return Object.fromEntries([...new Set(tagIds)].map((tagId) => [
    tagId,
    buildAssistantScope({
      activeEntry: null,
      activeTag: null,
      entries,
      selectedTagIds: [tagId],
      tags
    })
  ])) satisfies Record<string, ScopeSnapshot>;
}

export function composerMentionsFromMessages(messages: ConversationMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => (message.parts ?? []).flatMap((part) =>
      part.type === 'context-snapshot' ? part.composer?.mentions ?? [] : []
    ));
}

export function buildConversationMentionScope({
  entries,
  messages,
  tags
}: {
  entries: LibraryEntry[];
  messages: ConversationMessage[];
  tags: TagMeta[];
}) {
  return buildMentionScope({ entries, mentions: composerMentionsFromMessages(messages), tags });
}

export function buildMentionScope({
  entries,
  mentions,
  tags
}: {
  entries: LibraryEntry[];
  mentions: AssistantComposerMention[];
  tags: TagMeta[];
}): ScopeSnapshot {
  const tagIds = mentions.flatMap((mention) =>
    mention.kind === 'tag' && mention.tagId ? [mention.tagId] : []
  );
  // No historical Tag mention means no additional scope, not the whole library.
  const tagScope = tagIds.length ? buildAssistantScope({
    activeEntry: null,
    activeTag: null,
    entries,
    selectedTagIds: tagIds,
    tags
  }) : { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
  const knownEntryIds = new Set(entries.map((entry) => entry.id));
  const explicitEntryScope: ScopeSnapshot = {
    entry_ids: [], entry_titles: [], tag_ids: [], tag_names: []
  };
  let hasUnknownEntry = false;
  for (const mention of mentions) {
    if (mention.kind === 'tag' || !mention.entryId) continue;
    if (!knownEntryIds.has(mention.entryId)) {
      hasUnknownEntry = true;
      continue;
    }
    if (explicitEntryScope.entry_ids.includes(mention.entryId)) continue;
    explicitEntryScope.entry_ids.push(mention.entryId);
    explicitEntryScope.entry_titles.push(mention.entryTitle || mention.entryId);
  }
  if (hasUnknownEntry) explicitEntryScope.scope_intent = 'unresolved';
  else if (explicitEntryScope.entry_ids.length > 0) explicitEntryScope.scope_intent = 'selection';
  return mergeScopeSnapshots(tagScope, explicitEntryScope);
}

/**
 * The scope `search_library` may search for one run. Only the current selection, the mentions in
 * the submitted message and the attached context are explicit. Conversation history never widens
 * or narrows this result, and a whole-library current scope with no explicit additions stays the
 * whole library. An explicit empty part (for example an empty Tag) yields an empty scope, and it
 * never becomes a different paper set.
 */
export function retrievalRunScope({
  contextItems,
  currentScope,
  mentionScope
}: {
  contextItems: Array<{ entryId: string; entryTitle: string }>;
  currentScope: ScopeSnapshot;
  mentionScope: ScopeSnapshot;
}): ScopeSnapshot {
  const explicitParts: ScopeSnapshot[] = [];
  for (const part of [currentScope, mentionScope]) {
    const intent = effectiveScopeIntent(part);
    if (intent === 'selection' || intent === 'unresolved') explicitParts.push(part);
  }
  if (contextItems.length > 0) {
    explicitParts.push({
      tag_ids: [],
      tag_names: [],
      entry_ids: contextItems.map((item) => item.entryId),
      entry_titles: contextItems.map((item) => item.entryTitle),
      scope_intent: 'selection'
    });
  }
  const libraryScope: ScopeSnapshot = {
    tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [], scope_intent: 'library'
  };
  if (explicitParts.length === 0) return libraryScope;
  if (explicitParts.some((part) => effectiveScopeIntent(part) === 'unresolved')) {
    return { ...libraryScope, scope_intent: 'unresolved' };
  }
  const emptyPart = explicitParts.find((part) => part.entry_ids.length === 0);
  if (emptyPart) {
    return {
      tag_ids: emptyPart.tag_ids,
      tag_names: emptyPart.tag_names,
      entry_ids: [],
      entry_titles: [],
      scope_intent: 'selection'
    };
  }
  const entryIds: string[] = [];
  const entryTitles: string[] = [];
  for (const part of explicitParts) {
    part.entry_ids.forEach((entryId, index) => {
      if (entryIds.includes(entryId)) return;
      entryIds.push(entryId);
      entryTitles.push(part.entry_titles[index] ?? entryId);
    });
  }
  // A Tag keeps its identity only when it is the sole explicit source, so the search reports `explicit_tag`.
  const soleTagPart = explicitParts.length === 1 ? explicitParts[0] : null;
  return {
    tag_ids: soleTagPart?.tag_ids ?? [],
    tag_names: soleTagPart?.tag_names ?? [],
    entry_ids: entryIds,
    entry_titles: entryTitles,
    scope_intent: 'selection'
  };
}

export function assistantRunBaseScope({
  currentScope,
  conversationScope
}: {
  currentScope: ScopeSnapshot;
  conversationScope?: ScopeSnapshot | null;
}) {
  return conversationScope
    ? mergeScopeSnapshots(conversationScope, currentScope)
    : currentScope;
}

/** A scope without intent (legacy, or a neutral mention scope) is a selection only when it lists entries. */
function effectiveScopeIntent(scope: ScopeSnapshot): ScopeIntent | undefined {
  if (scope.scope_intent) return scope.scope_intent;
  return scope.entry_ids.length > 0 ? 'selection' : undefined;
}

/** Union semantics: an unresolved reference or a whole-library side dominates a narrower selection. */
function mergeScopeIntents(primary?: ScopeIntent, additional?: ScopeIntent): ScopeIntent | undefined {
  if (primary === 'unresolved' || additional === 'unresolved') return 'unresolved';
  if (primary === 'library' || additional === 'library') return 'library';
  if (primary === 'selection' || additional === 'selection') return 'selection';
  return undefined;
}

export function mergeScopeSnapshots(
  primary: ScopeSnapshot,
  additional: ScopeSnapshot
): ScopeSnapshot {
  const entryIds = [...primary.entry_ids];
  const entryTitles = [...primary.entry_titles];
  additional.entry_ids.forEach((entryId, index) => {
    if (entryIds.includes(entryId)) return;
    entryIds.push(entryId);
    entryTitles.push(additional.entry_titles[index] ?? entryId);
  });
  const tagIds = [...new Set([...primary.tag_ids, ...additional.tag_ids])];
  const tagNames = [...new Set([...primary.tag_names, ...additional.tag_names])];
  const intent = mergeScopeIntents(effectiveScopeIntent(primary), effectiveScopeIntent(additional));
  // Legacy inputs stay legacy: an intent is written only when a side already carried one.
  const hasExplicitIntent = primary.scope_intent !== undefined || additional.scope_intent !== undefined;
  return {
    entry_ids: entryIds,
    entry_titles: entryTitles,
    tag_ids: tagIds,
    tag_names: tagNames,
    ...(intent && hasExplicitIntent ? { scope_intent: intent } : {})
  };
}

export function mergeScopeWithContextEntries(
  scope: ScopeSnapshot,
  assistantContext: AssistantContext
): ScopeSnapshot {
  if (assistantContext.items.length === 0) return scope;
  const entryIds = [...scope.entry_ids];
  const entryTitles = [...scope.entry_titles];
  for (const item of assistantContext.items) {
    if (entryIds.includes(item.entryId)) continue;
    entryIds.push(item.entryId);
    entryTitles.push(item.entryTitle);
  }
  // Explicit composer context narrows an unscoped run to the attached papers. A whole-library
  // or unresolved intent stays as it is; the attached papers are already part of the library.
  const intent = scope.scope_intent === 'library' || scope.scope_intent === 'unresolved'
    ? scope.scope_intent
    : 'selection';
  return { ...scope, entry_ids: entryIds, entry_titles: entryTitles, scope_intent: intent };
}
