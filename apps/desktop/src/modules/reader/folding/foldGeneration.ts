/*
 * Prompt and unit assembly adapted from TextFold textfold/ladder.py, revision
 * 5fc941dc4560ee2809c0f278da28457292c7f739.
 * Copyright 2026 Xia Chen. Licensed under the Apache License, Version 2.0.
 * Modified for NeuInk's model provider, segment identifiers, and validation.
 */
import { runJsonModelTask } from '@/modules/assistant/sdk/modelTasks';
import type { LlmProfile } from '@/shared/ipc/assistantApi';

import type { FoldInput } from './foldInput';
import { buildFoldPrompt, FOLD_SYSTEM_PROMPT, type FoldPromptContext } from './foldPrompt';
import { validateFoldBatch, type ValidatedFoldBatch } from './foldResult';

/** Restore the actual span's casing; never accept a paraphrase as source text. */
function exactTopicSpan(takeaway: string, value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return value;
  const topic = value.trim();
  if (takeaway.includes(topic)) return topic;
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'iu').exec(takeaway)?.[0] ?? topic;
}

/** Shared model adapter; the generation queue passes exactly one paragraph per request. */
export async function generateFoldBatch({
  batch,
  profile,
  context,
  signal
}: {
  batch: readonly FoldInput[];
  profile: LlmProfile;
  context?: FoldPromptContext;
  signal?: AbortSignal;
}): Promise<ValidatedFoldBatch> {
  if (batch.length === 0) return { results: [], failedSegmentUids: [] };
  const output = await runJsonModelTask({
    settings: profile,
    name: 'paragraph_reading_levels',
    description: 'Faithful reading levels and validated source sentence indices for each input paragraph.',
    abortSignal: signal,
    timeoutMs: 120_000,
    system: FOLD_SYSTEM_PROMPT,
    prompt: buildFoldPrompt(batch, context)
  });
  const units = output && typeof output === 'object' && 'units' in output && Array.isArray(output.units) ? output.units : [];
  const segments = units.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const match = typeof row.id === 'string' ? /^U(0|[1-9]\d*)$/.exec(row.id) : null;
    const input = match ? batch[Number(match[1])] : undefined;
    if (!input) return [];
    const takeaway = typeof row.takeaway === 'string' ? row.takeaway.trim() : '';
    const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(takeaway);
    const separator = /[.!?。！？]$/.test(takeaway) ? (cjk ? '' : ' ') : cjk ? '。' : '. ';
    return [{ segment_uid: input.segmentUid, takeaway, topic: exactTopicSpan(takeaway, row.topic), evidence: row.evidence,
      key: takeaway + (reason ? separator + reason : '') }];
  });
  return validateFoldBatch(batch, { segments });
}
