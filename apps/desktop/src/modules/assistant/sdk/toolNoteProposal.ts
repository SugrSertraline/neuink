import {
  isLocalConversationSource,
  type AssistantContextSnapshot,
  type ConversationSourceLink,
  type ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import {
  type AssistantActiveNote,
  type AssistantContext,
  type AssistantEntryMetaTarget,
  type AssistantNoteProposal,
  type AssistantNoteProposalAction,
  type AssistantNoteProposalSource,
  type AssistantSegmentContextItem,
  type AssistantTaskPlan
} from '@/shared/types/assistant';
import { assertInlineNoteCitations } from './noteCitations';
import {
  markdownPatchOperations,
  patchOperationsPreview,
  proposalAfterMarkdown,
  proposalBeforeMarkdown
} from './noteProposalPreview';
import { ToolPreconditionError } from './toolFailurePolicy';
import { entryIdOrSingleScope } from './toolInput';
import {
  asObject,
  noteSnapshotKey,
  optionalNumber,
  optionalString,
  requiredString,
  stringArray,
  type JsonObject
} from './toolValues';

export function buildNoteProposal(
  input: unknown,
  {
    assistantContext,
    availableEntries,
    contextSnapshot,
    currentEntry,
    currentNote,
    plan,
    readNoteSnapshots,
    scope,
    sourceByMarker
  }: {
    assistantContext?: AssistantContext | null;
    availableEntries: AssistantEntryMetaTarget[];
    contextSnapshot?: AssistantContextSnapshot | null;
    currentEntry?: { id: string; title: string } | null;
    currentNote?: AssistantActiveNote | null;
    plan?: AssistantTaskPlan;
    readNoteSnapshots: Map<string, { markdown: string; title: string }>;
    scope: ScopeSnapshot;
    sourceByMarker: Map<number, ConversationSourceLink>;
  }
): AssistantNoteProposal {
  const object = asObject(input);
  const plannedSegmentTarget = plan?.target.kind === 'segment_note'
    ? segmentTargetFromPlan(plan, assistantContext)
    : null;
  const defaultSegmentTarget =
    plannedSegmentTarget ??
    assistantContext?.items.find(
      (item): item is AssistantSegmentContextItem => item.kind === 'segment'
    ) ??
    null;
  const targetKind = noteProposalTargetKind(
    object.target ?? (plan?.target.kind === 'segment_note' ? 'segment_note' : undefined),
    {
    currentNote,
    defaultSegmentTarget,
    object
    }
  );
  const hasPlannedMarkdownNote =
    targetKind === 'markdown_note' && Boolean(plan?.target.noteId);
  const action = noteProposalAction(plan?.noteAction ?? object.action, {
    currentNote,
    hasPlannedMarkdownNote,
    targetKind
  });
  const entryId =
    optionalString(object.entry_id) ??
    (plan?.needsNoteProposal ? plan.target.entryId : null) ??
    (targetKind === 'markdown_note' ? currentNote?.entryId : null) ??
    (targetKind === 'segment_note' ? defaultSegmentTarget?.entryId : null) ??
    currentEntry?.id ??
    null;

  if (!entryId) {
    throw new ToolPreconditionError('note_target_required');
  }
  entryIdOrSingleScope(entryId, scope);

  const entryTitle =
    targetKind === 'segment_note' && defaultSegmentTarget?.entryId === entryId
      ? defaultSegmentTarget.entryTitle
      : currentNote?.entryId === entryId
      ? currentNote.entryTitle
      : currentEntry?.id === entryId
        ? currentEntry.title
        : availableEntries.find((entry) => entry.id === entryId)?.title ??
          scope.entry_titles[scope.entry_ids.indexOf(entryId)] ??
          entryId;
  const segmentUid =
    targetKind === 'segment_note'
      ? optionalString(object.segment_uid) ?? plan?.target.segmentUid ?? defaultSegmentTarget?.segmentUid ?? null
      : null;
  const pageIdx =
    targetKind === 'segment_note'
      ? optionalNumber(object.page_idx) ?? defaultSegmentTarget?.pageIdx ?? null
      : null;

  if (targetKind === 'segment_note' && !segmentUid) {
    throw new ToolPreconditionError('note_target_required');
  }

  const noteId = targetKind === 'segment_note' || action === 'create'
    ? null
    : optionalString(object.note_id) ?? plan?.target.noteId ?? currentNote?.noteId ?? null;

  if (targetKind === 'markdown_note' && action !== 'create' && !noteId) {
    throw new ToolPreconditionError('note_target_required');
  }

  const noteTitle =
    targetKind === 'segment_note'
      ? `Segment Note${pageIdx === null ? '' : ` p.${pageIdx + 1}`}`
      : optionalString(object.note_title) ??
        (noteId ? readNoteSnapshots.get(noteSnapshotKey(entryId, noteId))?.title ?? null : null) ??
        (currentNote?.noteId === noteId ? currentNote.noteTitle : null);
  const title =
    optionalString(object.title) ??
    noteTitle ??
    (action === 'create' ? 'AI note' : 'Updated note');
  const patchOperations = action === 'patch' || action === 'delete'
    ? markdownPatchOperations(object.patch_operations)
    : undefined;
  const markdown =
    action === 'patch' || action === 'delete'
      ? optionalString(object.markdown) ?? patchOperationsPreview(patchOperations ?? [])
      : requiredString(object.markdown, 'markdown');
  if (
    (plan?.needsCurrentNote || plan?.editCoordinatePolicy === 'line_and_hash') &&
    patchOperations?.some((operation) =>
      operation.type !== 'replace_lines' &&
      operation.type !== 'delete_lines' &&
      operation.type !== 'insert_lines'
    )
  ) {
    throw new ToolPreconditionError('patch_coordinates_required');
  }
  if (
    plan?.editCoordinatePolicy === 'line_and_hash' &&
    noteId &&
    !readNoteSnapshots.has(noteSnapshotKey(entryId, noteId))
  ) {
    throw new ToolPreconditionError('note_read_required');
  }
  const citationMarkdown = action === 'patch' || action === 'delete'
    ? patchOperationsPreview(patchOperations ?? [])
    : markdown;
  const sourceMarkers = [
    ...stringArray(object.source_markers),
    ...markersFromMarkdown(citationMarkdown)
  ];
  const sources = sourcesFromMarkers(sourceMarkers, sourceByMarker);
  if (targetKind === 'markdown_note') {
    assertInlineNoteCitations(citationMarkdown, sources.map(source => source.marker!));
  }
  const beforeMarkdown = proposalBeforeMarkdown({
    action,
    contextSnapshot,
    entryId,
    noteId,
    readNoteSnapshots,
    targetKind
  });
  const afterMarkdown = proposalAfterMarkdown({
    action,
    beforeMarkdown,
    markdown,
    patchOperations,
    targetKind
  });

  return {
    action,
    afterMarkdown,
    beforeMarkdown,
    createdAt: new Date().toISOString(),
    entryId,
    entryTitle,
    id: `note-proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    markdown,
    noteId,
    noteTitle,
    pageIdx,
    patchOperations,
    rationale: optionalString(object.rationale) ?? undefined,
    segmentUid,
    sources,
    status: 'pending',
    targetKind,
    title
  };
}

export function noteProposalAction(
  value: unknown,
  {
    currentNote,
    hasPlannedMarkdownNote,
    targetKind
  }: {
    currentNote?: AssistantActiveNote | null;
    hasPlannedMarkdownNote: boolean;
    targetKind: 'markdown_note' | 'segment_note';
  }
): AssistantNoteProposalAction {
  if (
    value === 'append' ||
    value === 'create' ||
    value === 'delete' ||
    value === 'patch' ||
    value === 'prepend' ||
    value === 'replace'
  ) {
    if (targetKind === 'segment_note' && value === 'create') {
      return 'append';
    }
    return value;
  }

  return currentNote || hasPlannedMarkdownNote ? 'append' : 'create';
}

export function noteProposalTargetKind(
  value: unknown,
  {
    currentNote,
    defaultSegmentTarget,
    object
  }: {
    currentNote?: AssistantActiveNote | null;
    defaultSegmentTarget?: { segmentUid: string } | null;
    object: JsonObject;
  }
): 'markdown_note' | 'segment_note' {
  if (value === 'markdown_note' || value === 'segment_note') {
    return value;
  }

  if (optionalString(object.segment_uid)) {
    return 'segment_note';
  }

  if (
    !currentNote &&
    defaultSegmentTarget &&
    (object.action === 'append' || object.action === 'prepend' || object.action === 'replace')
  ) {
    return 'segment_note';
  }

  return 'markdown_note';
}

export function segmentTargetFromPlan(
  plan: AssistantTaskPlan,
  assistantContext?: AssistantContext | null
): {
  entryId: string;
  entryTitle: string;
  pageIdx: number | null;
  segmentUid: string;
} | null {
  const segmentUid = plan.target.segmentUid;
  if (!segmentUid) {
    return null;
  }

  const contextItem = assistantContext?.items.find(
    (item) =>
      item.kind === 'segment' &&
      item.segmentUid === segmentUid &&
      (!plan.target.entryId || item.entryId === plan.target.entryId)
  ) as AssistantSegmentContextItem | undefined;
  if (contextItem) {
    return contextItem;
  }

  if (!plan.target.entryId) {
    return null;
  }

  return {
    entryId: plan.target.entryId,
    entryTitle: plan.target.entryId,
    pageIdx: optionalNumber((plan.target as Record<string, unknown>).pageIdx) ?? null,
    segmentUid
  };
}

export function markersFromMarkdown(markdown: string) {
  return [...markdown.matchAll(/\[S(\d+)]/g)].map((match) => `S${match[1]}`);
}

export function sourcesFromMarkers(
  markers: string[],
  sourceByMarker: Map<number, ConversationSourceLink>
): AssistantNoteProposalSource[] {
  const seen = new Set<number>();
  const sources: AssistantNoteProposalSource[] = [];

  for (const marker of markers) {
    const markerNumber = Number(marker.replace(/[[\]S\s]/gi, ''));
    if (seen.has(markerNumber)) continue;
    if (!Number.isInteger(markerNumber) || markerNumber < 1) throw new Error('Invalid evidence marker.');

    const source = sourceByMarker.get(markerNumber);
    if (!source) throw new Error(`Unknown evidence marker: S${markerNumber}`);
    if (!isLocalConversationSource(source)) throw new ToolPreconditionError('local_source_required');

    seen.add(markerNumber);
    sources.push({
      entryId: source.entry_id,
      entryTitle: source.entry_title,
      marker: `S${markerNumber}`,
      pageIdx: source.page_idx,
      quote: source.quote,
      segmentUid: source.segment_uid
    });
  }

  return sources;
}

export function noteProposalSummary(proposal: AssistantNoteProposal) {
  if (proposal.targetKind === 'segment_note') {
    return `Prepared a ${proposal.action === 'replace' ? 'replacement' : 'segment note'} proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  if (proposal.action === 'create') {
    return `Prepared a new note proposal: ${proposal.title}.`;
  }
  if (proposal.action === 'append') {
    return `Prepared an append proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  if (proposal.action === 'prepend') {
    return `Prepared a prepend proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  if (proposal.action === 'patch') {
    return `Prepared a patch proposal for ${proposal.noteTitle ?? proposal.title}.`;
  }
  return `Prepared a replacement proposal for ${proposal.noteTitle ?? proposal.title}.`;
}
