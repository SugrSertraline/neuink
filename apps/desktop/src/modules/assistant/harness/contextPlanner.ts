import type {
  AssistantComposerSnapshot,
  AssistantContextItem,
  AssistantContextPlan,
  AssistantContextPlanItem
} from '@/shared/types/assistant';

/**
 * Builds a structural hydration plan only. Semantic roles such as source versus
 * destination are decided by the Agent from the typed mention map and surrounding
 * natural language, never by UI regexes.
 */
export function planAssistantContext({
  composerSnapshot,
  items
}: {
  composerSnapshot?: AssistantComposerSnapshot | null;
  items: AssistantContextItem[];
  question: string;
}): AssistantContextPlan | null {
  if (items.length === 0 && (composerSnapshot?.mentions.length ?? 0) === 0) return null;

  const plannedItems = items.map((item) => structuralPlanItem(
    item,
    composerSnapshot?.mentions.find((mention) => mention.id === item.id)?.marker
  ));
  const referenceCount = Math.max(items.length, composerSnapshot?.mentions.length ?? 0);
  return {
    editTarget: null,
    items: plannedItems,
    summary: `Context references: ${referenceCount}. Agent decides read/write roles from typed mentions.`
  };
}

function structuralPlanItem(
  item: AssistantContextItem,
  mentionMarker?: string
): AssistantContextPlanItem {
  if (item.kind === 'segment') {
    return {
      attachmentId: item.id,
      entryId: item.entryId,
      entryTitle: item.entryTitle,
      hydration: 'full_if_budget',
      kind: 'segment',
      reason: `Explicit Segment reference${mentionMarker ? ` at ${mentionMarker}` : ''}.`,
      role: 'evidence',
      segmentUid: item.segmentUid
    };
  }

  const contentKind = item.contentKind ?? 'entry';
  return {
    attachmentId: item.id,
    contentId: item.contentId,
    entryId: item.entryId,
    entryTitle: item.entryTitle,
    hydration: contentKind === 'note' ? 'full_if_budget' : 'search_first',
    kind: contentKind,
    reason: `Explicit ${contentKind} reference${mentionMarker ? ` at ${mentionMarker}` : ''}.`,
    role: contentKind === 'note' ? 'evidence' : 'read'
  };
}
