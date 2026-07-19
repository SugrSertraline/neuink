import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { AssistantEvidenceLedger, AssistantEvidenceRecord } from '@/shared/types/assistant';

export function registerEvidence(
  ledger: AssistantEvidenceLedger,
  sources: ConversationSourceLink[]
): AssistantEvidenceLedger {
  const bySource = new Map(
    ledger.evidence.map((item) => [sourceKey(item.entryId, item.segmentUid), item])
  );
  for (const source of sources) {
    const key = sourceKey(source.entry_id, source.segment_uid);
    if (bySource.has(key)) continue;
    bySource.set(key, toEvidenceRecord(ledger.taskId, source));
  }
  return {
    ...ledger,
    evidence: [...bySource.values()],
    updatedAt: new Date().toISOString()
  };
}

function toEvidenceRecord(
  taskId: string,
  source: ConversationSourceLink
): AssistantEvidenceRecord {
  const quoteHash = stableHash(source.quote);
  return {
    acquiredBy: 'document_read',
    entryId: source.entry_id,
    entryTitle: source.entry_title,
    evidenceId: `evidence-${stableHash(`${taskId}:${source.entry_id}:${source.segment_uid}`)}`,
    pageIdx: source.page_idx,
    quote: source.quote,
    quoteHash,
    segmentUid: source.segment_uid
  };
}

export function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sourceKey(entryId: string, segmentUid: string) {
  return `${entryId}:${segmentUid}`;
}
