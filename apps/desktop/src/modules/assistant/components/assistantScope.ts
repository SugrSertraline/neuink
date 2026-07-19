import type { ConversationMessage, ScopeSnapshot } from '@/shared/ipc/assistantApi';
import type { AssistantContext } from '@/shared/types/assistant';
import type { TagMeta } from '@/shared/types/domain';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { collectDescendantTagIds } from '@/modules/library/utils/tagTree';

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
      entry_titles: scopedEntries.map((entry) => entry.title)
    };
  }

  const scopedEntries = activeEntry
    ? [activeEntry]
    : entries.filter((entry) => entry.status === 'Parsed');
  return {
    tag_ids: [],
    tag_names: [],
    entry_ids: scopedEntries.map((entry) => entry.id),
    entry_titles: scopedEntries.map((entry) => entry.title)
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
  const mentions = composerMentionsFromMessages(messages);
  const tagIds = mentions.flatMap((mention) =>
    mention.kind === 'tag' && mention.tagId ? [mention.tagId] : []
  );
  const tagScope = buildAssistantScope({
    activeEntry: null,
    activeTag: null,
    entries,
    selectedTagIds: tagIds,
    tags
  });
  const explicitEntryScope: ScopeSnapshot = {
    entry_ids: [], entry_titles: [], tag_ids: [], tag_names: []
  };
  for (const mention of mentions) {
    if (mention.kind === 'tag' || !mention.entryId || explicitEntryScope.entry_ids.includes(mention.entryId)) {
      continue;
    }
    explicitEntryScope.entry_ids.push(mention.entryId);
    explicitEntryScope.entry_titles.push(mention.entryTitle || mention.entryId);
  }
  return mergeScopeSnapshots(tagScope, explicitEntryScope);
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
  return { entry_ids: entryIds, entry_titles: entryTitles, tag_ids: tagIds, tag_names: tagNames };
}

export function mergeScopeWithContextEntries(
  scope: ScopeSnapshot,
  assistantContext: AssistantContext
): ScopeSnapshot {
  const entryIds = [...scope.entry_ids];
  const entryTitles = [...scope.entry_titles];
  for (const item of assistantContext.items) {
    if (entryIds.includes(item.entryId)) continue;
    entryIds.push(item.entryId);
    entryTitles.push(item.entryTitle);
  }
  return { ...scope, entry_ids: entryIds, entry_titles: entryTitles };
}
