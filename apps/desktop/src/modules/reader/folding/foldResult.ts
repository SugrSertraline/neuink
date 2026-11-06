import type { FoldInput } from './foldInput';

export type FoldResult = {
  segmentUid: string;
  /** Exact input used to generate this result; compare before reuse. */
  source: string;
  evidence: number[];
  brief: string[];
  key: string;
  takeaway: string;
  topic: string;
};

export type ValidatedFoldBatch = {
  results: FoldResult[];
  failedSegmentUids: string[];
};

/** Treat model output as untrusted: retain original sentences only by validated indices. */
export function validateFoldBatch(batch: readonly FoldInput[], output: unknown): ValidatedFoldBatch {
  const rows = output && typeof output === 'object' && 'segments' in output
    ? (output as { segments: unknown }).segments : null;
  const candidates = Array.isArray(rows) ? rows : [];
  const results: FoldResult[] = [];
  const failedSegmentUids: string[] = [];

  for (const input of batch) {
    const matches = candidates.filter((row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && (row as Record<string, unknown>).segment_uid === input.segmentUid
    );
    const row = matches.length === 1 ? matches[0] : null;
    const indices = row?.evidence;
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const key = text(row?.key);
    const takeaway = text(row?.takeaway);
    const topic = text(row?.topic);
    const validEvidence = Array.isArray(indices) && indices.length >= 1 && indices.length <= 3 &&
      indices.every((value, index) => Number.isInteger(value) && value >= 0 && value < input.sentences.length &&
        (index === 0 || value > indices[index - 1]));
    // TextFold's Topic is an exact span of the Takeaway; Key leads with it.
    if (!row || !validEvidence || !key || !takeaway || !topic || !key.startsWith(takeaway) || !takeaway.includes(topic)) {
      failedSegmentUids.push(input.segmentUid);
      continue;
    }
    results.push({
      segmentUid: input.segmentUid,
      source: input.source,
      evidence: indices,
      brief: indices.map(index => input.sentences[index]),
      key,
      takeaway,
      topic
    });
  }
  return { results, failedSegmentUids };
}

export function foldResultMatchesSource(result: FoldResult, source: string): boolean {
  return result.source === source.trim();
}
