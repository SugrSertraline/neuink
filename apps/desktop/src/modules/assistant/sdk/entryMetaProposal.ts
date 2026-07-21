import {
  isLocalConversationSource,
  type ConversationSourceLink,
  type LocalConversationSourceLink
} from '@/shared/ipc/assistantApi';
import type {
  AssistantEntryMetaProposal,
  AssistantEntryMetaTarget,
  AssistantNoteProposalSource,
  AssistantTaskPlan
} from '@/shared/types/assistant';

export function buildEntryMetaProposal(
  input: unknown,
  {
    entries,
    plan,
    sourceByMarker
  }: {
    entries: AssistantEntryMetaTarget[];
    plan: AssistantTaskPlan;
    sourceByMarker: Map<number, ConversationSourceLink>;
  }
): AssistantEntryMetaProposal {
  const object = asObject(input);
  const entryId = optionalString(object.entry_id) ?? plan.entryMetaChange?.entryId;
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw new Error('entry_id must identify an existing Entry before proposing metadata changes.');
  }

  const fields = plan.entryMetaChange?.fields ?? [
    ...(optionalString(object.title) ? ['title' as const] : []),
    ...(typeof object.description === 'string' ? ['description' as const] : [])
  ];
  if (fields.length === 0) {
    throw new Error('Provide title, description, or both in the proposal tool call.');
  }

  const afterTitle = fields.includes('title')
    ? requiredString(object.title, 'title')
    : entry.title;
  const afterDescription = fields.includes('description')
    ? requiredStringAllowEmpty(object.description, 'description')
    : entry.description;
  if (afterTitle === entry.title && afterDescription === entry.description) {
    throw new Error('The proposed Entry metadata is identical to the current metadata.');
  }
  const sources = sourcesFromMarkers(stringArray(object.source_markers), sourceByMarker);
  if (plan.citationPolicy === 'required' && !hasTargetSource(sources, entry.id)) {
    const fallback = bestTargetSource(object, entry.id, sourceByMarker);
    if (fallback) sources.push(fallback);
  }
  if (
    plan.citationPolicy === 'required' &&
    !hasTargetSource(sources, entry.id)
  ) {
    throw new Error('Paper-derived Entry metadata requires a valid source marker from that Entry.');
  }

  return {
    afterDescription,
    afterTitle,
    baseUpdatedAt: entry.updatedAt,
    beforeDescription: entry.description,
    beforeTitle: entry.title,
    createdAt: new Date().toISOString(),
    entryId: entry.id,
    entryTitle: entry.title,
    fields,
    id: `entry-meta-proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    rationale: optionalString(object.rationale),
    sources,
    status: 'pending'
  };
}

function sourcesFromMarkers(
  markers: string[],
  sourceByMarker: Map<number, ConversationSourceLink>
) {
  const seen = new Set<number>();
  const sources: AssistantNoteProposalSource[] = [];
  for (const marker of markers) {
    const markerNumber = Number(marker.replace(/[[\]S\s]/gi, ''));
    const source = sourceByMarker.get(markerNumber);
    if (!source || !isLocalConversationSource(source) || seen.has(markerNumber)) continue;
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

function bestTargetSource(
  object: Record<string, unknown>,
  entryId: string,
  sourceByMarker: Map<number, ConversationSourceLink>
) {
  const metadataText = [optionalString(object.title), optionalString(object.description)]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const candidates = [...sourceByMarker.entries()]
    .filter((candidate): candidate is [number, LocalConversationSourceLink] =>
      isLocalConversationSource(candidate[1]) && candidate[1].entry_id === entryId
    )
    .map((candidate) => ({
      candidate,
      score: sourceMatchScore(candidate[1].quote, metadataText)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  const [candidate] = candidates;
  if (!candidate) return undefined;
  const [marker, source] = candidate.candidate;
  return {
    entryId: source.entry_id,
    entryTitle: source.entry_title,
    marker: `S${marker}`,
    pageIdx: source.page_idx,
    quote: source.quote,
    segmentUid: source.segment_uid
  } satisfies AssistantNoteProposalSource;
}

function sourceMatchScore(quote: string, metadataText: string) {
  const normalizedQuote = normalizeEvidenceText(quote);
  const normalizedMetadata = normalizeEvidenceText(metadataText);
  if (!normalizedMetadata) return 0;
  if (normalizedQuote.includes(normalizedMetadata)) return 10_000 + normalizedMetadata.length;
  const tokens = normalizedMetadata.split(' ').filter((token) => token.length > 1);
  return tokens.reduce((score, token) =>
    score + (normalizedQuote.includes(token) ? token.length : 0), 0);
}

function normalizeEvidenceText(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function hasTargetSource(sources: AssistantNoteProposalSource[], entryId: string) {
  return sources.some((source) => source.entryId === entryId);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string) {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new Error(`${field} is required.`);
  }
  return parsed;
}

function requiredStringAllowEmpty(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
