import { conversationSourceSnapshotKey, type ConversationSourceLink, type AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';

export function normalizeCitedSources(
  answer: string,
  sourceByMarker: Map<number, ConversationSourceLink>,
  toolEvents: AssistantToolTraceEvent[]
): { answer: string; sources: ConversationSourceLink[] } {
  const citedMarkers: number[] = [];
  for (const match of answer.matchAll(/\[S(\d+)]/g)) {
    const marker = Number(match[1]);
    if (sourceByMarker.has(marker) && !citedMarkers.includes(marker)) {
      citedMarkers.push(marker);
    }
  }

  for (const event of toolEvents) {
    if (event.status !== 'done' || !event.diagram) continue;
    for (const marker of event.diagram.sourceMarkers) {
      if (sourceByMarker.has(marker) && !citedMarkers.includes(marker)) citedMarkers.push(marker);
    }
  }

  if (citedMarkers.length === 0) {
    return {
      answer,
      sources: []
    };
  }

  const renumbered = new Map<number, number>();
  const sourceNumbers = new Map<string, number>();
  const sources: ConversationSourceLink[] = [];
  for (const marker of citedMarkers) {
    const source = sourceByMarker.get(marker)!;
    const key = conversationSourceSnapshotKey(source);
    if (!sourceNumbers.has(key)) { sources.push(source); sourceNumbers.set(key, sources.length); }
    renumbered.set(marker, sourceNumbers.get(key)!);
  }
  for (const event of toolEvents) {
    if (event.status !== 'done' || !event.diagram) continue;
    const original = event.diagram.sourceMarkers;
    event.sources = original.map(marker => sourceByMarker.get(marker)).filter((source): source is ConversationSourceLink => Boolean(source));
    event.diagram = { ...event.diagram,
      sourceMarkers: original.map(marker => renumbered.get(marker)).filter((marker): marker is number => marker !== undefined) };
  }
  const normalizedAnswer = answer.replace(/\[S(\d+)]/g, (full, markerText: string) => {
    const nextMarker = renumbered.get(Number(markerText));
    return nextMarker ? `[S${nextMarker}]` : full;
  });

  return {
    answer: normalizedAnswer,
    sources
  };
}

export function uniqueConversationSources(sources: ConversationSourceLink[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = conversationSourceSnapshotKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
