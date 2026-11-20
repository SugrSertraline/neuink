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
  failureReasons?: Record<string, string>;
};

/** Treat model output as untrusted: retain original sentences only by validated indices. */
export function validateFoldBatch(batch: readonly FoldInput[], output: unknown): ValidatedFoldBatch {
  const rows = output && typeof output === 'object' && 'segments' in output
    ? (output as { segments: unknown }).segments : null;
  const candidates = Array.isArray(rows) ? rows : [];
  const results: FoldResult[] = [];
  const failedSegmentUids: string[] = [];
  const failureReasons: Record<string, string> = {};

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
      failureReasons[input.segmentUid] = !row ? (matches.length > 1 ? '模型重复返回同一段落。' : '模型未返回对应段落。')
        : !validEvidence ? '证据句编号无效：需要按原文顺序提供 1 至 3 个有效句子编号。'
        : !takeaway ? '模型没有返回结论。'
        : !key ? '模型没有返回要点。'
        : !topic ? '模型没有返回主题。'
        : !key.startsWith(takeaway) ? '要点没有以结论开头。'
        : '主题不是结论中的原文。';
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
  return { results, failedSegmentUids, ...(failedSegmentUids.length ? { failureReasons } : {}) };
}

export function foldResultMatchesSource(result: FoldResult, source: string): boolean {
  return result.source === source.trim();
}
